package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	var (
		listen  = flag.String("listen", ":9100", "HTTP listen address")
		dbPath  = flag.String("db", "/var/lib/dspark-agent/metrics.db", "SQLite time-series database path")
		ip      = flag.Int("interval", 5, "host collect interval (seconds)")
		vllmURL = flag.String("vllm", "", "vLLM /metrics URL to scrape (e.g. http://127.0.0.1:8888). empty = no vLLM scraping")
		retain  = flag.Duration("retention", 7*24*time.Hour, "series retention")
	)
	flag.Parse()

	if *dbPath == "" {
		log.Fatal("empty --db")
	}
	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		log.Fatalf("mkdir db dir: %v", err)
	}

	store, err := openStore(*dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer store.Close()

	st := &collectorState{}
	var vllm *collectorVllm
	if *vllmURL != "" {
		vllm = &collectorVllm{url: strings.TrimSuffix(*vllmURL, "/") + "/metrics"}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// main collect loop
	go func() {
		tick := time.NewTicker(time.Duration(*ip) * time.Second)
		defer tick.Stop()
		// immediate first run
		runCollection(ctx, store, st, vllm, *ip)
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				runCollection(ctx, store, st, vllm, *ip)
			}
		}
	}()

	// retention pruner
	go func() {
		tick := time.NewTicker(time.Hour)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				n, err := store.Prune(time.Now().Add(-*retain).Unix())
				if err != nil {
					log.Printf("prune: %v", err)
				} else if n > 0 {
					log.Printf("pruned %d rows", n)
				}
			}
		}
	}()

	// HTTP API
	mux := http.NewServeMux()
	api := &apiServer{store: store, started: time.Now(), hostname: mustHostname(), vllmURL: *vllmURL}
	mux.HandleFunc("/health", api.handleHealth)
	mux.HandleFunc("/series", api.handleSeries)
	mux.HandleFunc("/snapshot", api.handleSnapshot)
	mux.HandleFunc("/range", api.handleRange)
	mux.HandleFunc("/changes", api.handleChanges)

	srv := &http.Server{Addr: *listen, Handler: mux}
	go func() {
		log.Printf("dspark-agent listening on %s db=%s vllm=%q", *listen, *dbPath, *vllmURL)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}

func runCollection(ctx context.Context, store *store, st *collectorState, vllm *collectorVllm, intervalSec int) {
	now := time.Now().Unix()
	rows := make([]row, 0, 64)

	if h, err := st.collectHost(); err != nil {
		log.Printf("collect host: %v", err)
	} else {
		for k, v := range h {
			rows = append(rows, row{Name: k, Ts: now,Val: v})
		}
	}
	if vllm != nil {
		if vr, err := vllm.collect(); err != nil {
			log.Printf("collect vllm: %v", err)
		} else {
			for _, r := range vr {
				rows = append(rows, row{Name: r.Name, Ts: now, Val: r.Val})
			}
		}
	}

	if len(rows) == 0 {
		return
	}
	if err := store.Insert(rows); err != nil {
		log.Printf("insert %d rows: %v", len(rows), err)
		return
	}
	log.Printf("collected %d metrics at %d", len(rows), now)
}

// row is a single time-series point.
type row struct {
	Name string  `json:"n"`
	Ts   int64   `json:"t"`
	Val  float64 `json:"v"`
}

type apiServer struct {
	store    *store
	started  time.Time
	hostname string
	vllmURL  string
}

func mustHostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

const (
	paramName = "name"
	paramFrom = "from"
	paramTo   = "to"
	paramStep = "step"
	paramSince = "since"
	paramLimit = "limit"
)

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode: %v", err)
	}
}

func (a *apiServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"ok":         true,
		"hostname":   a.hostname,
		"uptime_s":   int64(time.Since(a.started).Seconds()),
		"vllm_url":   a.vllmURL,
		"db_rows":    a.store.Count(),
		"last_write": a.store.LastWrite(),
		"time":       time.Now().Unix(),
	})
}

func (a *apiServer) handleSeries(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"series": a.store.ListSeries(),
		"time":   time.Now().Unix(),
	})
}

func (a *apiServer) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"host":  a.hostname,
		"time":  time.Now().Unix(),
		"snap":  a.store.Snapshot(),
	})
}

func (a *apiServer) handleRange(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	name := q.Get(paramName)
	from, err := atoi(q.Get(paramFrom))
	if err != nil {
		http.Error(w, "bad from", http.StatusBadRequest)
		return
	}
	to, err := atoi(q.Get(paramTo))
	if err != nil {
		to = time.Now().Unix()
	}
	step := int64(0)
	if s := q.Get(paramStep); s != "" {
		if v, err := atoi(s); err == nil {
			step = v
		}
	}
	pts := a.store.Range(name, from, to, step)
	writeJSON(w, map[string]any{"name": name, "points": pts, "step": step})
}

func (a *apiServer) handleChanges(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	since, err := atoi(q.Get(paramSince))
	if err != nil {
		http.Error(w, "bad since", http.StatusBadRequest)
		return
	}
	limit := int64(200000)
	if s := q.Get(paramLimit); s != "" {
		if v, err := atoi(s); err == nil && v > 0 {
			limit = v
		}
	}
	rows, last := a.store.Changes(since, limit)
	writeJSON(w, map[string]any{"rows": rows, "last": last})
}

func atoi(s string) (int64, error) {
	var v int64
	_, err := fmt.Sscanf(s, "%d", &v)
	return v, err
}
