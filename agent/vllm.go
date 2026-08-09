package main

import (
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// collectorVllm scrapes a vLLM OpenAI-server Prometheus /metrics endpoint,
// stores raw gauges and derives rates/percentiles.
type collectorVllm struct {
	url string

	prev     map[string]float64 // previous counter values
	prevTime time.Time
}

type sample struct {
	name   string
	labels map[string]string
	value  float64
}

// collect returns the derived time-series rows for the current scrape.
func (v *collectorVllm) collect() ([]row, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(v.url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("vllm /metrics: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}

	samples := parsePrometheusText(string(body))
	now := time.Now()

	cur := collectCounters(samples)
	out := make([]row, 0, 24)
	nowTs := now.Unix()

	// --- raw gauges (always) ---
	for _, g := range gaugeFams {
		out = append(out, row{Name: g.name, Ts: nowTs, Val: g.get(cur)})
	}

	// --- deltas / rates (needs a previous scrape) ---
	if !v.prevTime.IsZero() {
		dt := now.Sub(v.prevTime).Seconds()
		if dt > 0 {
			diff := func(key string) float64 {
				d := cur[key] - v.prev[key]
				if d < 0 {
					d = 0 // counter reset (restart)
				}
				return d
			}
			rate := func(key, name string) {
				out = append(out, row{Name: name, Ts: nowTs, Val: diff(key) / dt})
			}
			rate("gen_tokens", "vllm.decode_tok_s")
			rate("prompt_tokens", "vllm.prompt_tok_s")
			rate("iter_tokens", "vllm.iter_tok_s")

			if dq := diff("prefix_queries"); dq > 0 {
				out = append(out, row{Name: "vllm.prefix_hit_rate", Ts: nowTs, Val: diff("prefix_hits") / dq})
			}
			if dp := diff("prompt_tokens"); dp > 0 {
				out = append(out, row{Name: "vllm.prompt_cached_pct", Ts: nowTs, Val: diff("prompt_cached") / dp * 100})
			}
			if dd := diff("spec_draft"); dd > 0 {
				out = append(out, row{Name: "vllm.spec_accept_rate", Ts: nowTs, Val: diff("spec_accepted") / dd})
			}
			if dn := diff("spec_drafts"); dn > 0 {
				out = append(out, row{Name: "vllm.spec_accept_len", Ts: nowTs, Val: diff("spec_accepted") / dn})
			}
			// per-position acceptance rates (position k: accepted_k / drafts)。
			// 只对 vLLM 实际发布的 position 生成系列：硬编码上界会产生
			// 永不更新的幽灵系列（例如只发布 0..4 时，position=5 恒为 0）。
			for _, k := range specPositions(samples) {
				key := fmt.Sprintf("spec_pos_accepted[position=%d]", k)
				if dn := diff("spec_drafts"); dn > 0 {
					out = append(out, row{Name: fmt.Sprintf("vllm.spec_pos_%d_rate", k), Ts: nowTs, Val: diff(key) / dn})
				}
			}
		}
	}

	// --- histogram percentiles (always) ---
	for _, h := range histFams {
		p50, p90, p99 := percentiles(samples, h.fam)
		out = append(out,
			row{Name: h.name + "_p50", Ts: nowTs, Val: p50},
			row{Name: h.name + "_p90", Ts: nowTs, Val: p90},
			row{Name: h.name + "_p99", Ts: nowTs, Val: p99},
		)
	}

	v.prev = cur
	v.prevTime = now
	return out, nil
}

// gaugeFams: raw series stored as-is each scrape.
type famDef struct {
	name string // output series name (without leading vllm.)
	key  string // counter key in cur map
	get  func(cur map[string]float64) float64
}

func gauges(outName string, key string) famDef {
	return famDef{name: outName, key: key, get: func(cur map[string]float64) float64 { return cur[key] }}
}

var gaugeFams = []famDef{
	gauges("vllm.kv_usage_pct", "kv_usage"),
	gauges("vllm.running", "running"),
	gauges("vllm.waiting", "waiting"),
	gauges("vllm.preemptions", "preemptions"),
	gauges("vllm.prompt_tok_total", "prompt_tokens"),
	gauges("vllm.gen_tok_total", "gen_tokens"),
	gauges("vllm.iter_tok_total", "iter_tokens"),
	gauges("vllm.prompt_cached_total", "prompt_cached"),
	gauges("vllm.prefix_hits_total", "prefix_hits"),
	gauges("vllm.prefix_queries_total", "prefix_queries"),
	gauges("vllm.spec_draft_total", "spec_draft"),
	gauges("vllm.spec_accept_total", "spec_accepted"),
	gauges("vllm.spec_drafts_total", "spec_drafts"),
}

var histFams = []struct {
	fam, name string
}{
	{"vllm:time_to_first_token_seconds", "vllm.ttft"},
	{"vllm:inter_token_latency_seconds", "vllm.itl"},
	{"vllm:e2e_request_latency_seconds", "vllm.e2e"},
	{"vllm:request_queue_time_seconds", "vllm.queue"},
}

// collectCounters flattens the relevant counter families (optionally
// label-scoped) into a single map keyed by short names.
func collectCounters(samples []sample) map[string]float64 {
	m := make(map[string]float64)
	add := func(key, fam string, kv map[string]string) {
		m[key] = valueOf(samples, fam, kv)
	}
	addCode := func(key, fam string) { add(key, fam, nil) }

	addCode("gen_tokens", "vllm:generation_tokens_total")
	addCode("prompt_tokens", "vllm:prompt_tokens_total")
	addCode("prompt_cached", "vllm:prompt_tokens_cached_total")
	addCode("iter_tokens", "vllm:iteration_tokens_total_sum")
	addCode("prefix_hits", "vllm:prefix_cache_hits_total")
	addCode("prefix_queries", "vllm:prefix_cache_queries_total")
	addCode("spec_draft", "vllm:spec_decode_num_draft_tokens_total")
	addCode("spec_accepted", "vllm:spec_decode_num_accepted_tokens_total")
	addCode("spec_drafts", "vllm:spec_decode_num_drafts_total")
	add("kv_usage", "vllm:kv_cache_usage_perc", nil)
	add("running", "vllm:num_requests_running", nil)
	add("waiting", "vllm:num_requests_waiting", nil)
	add("preemptions", "vllm:num_preemptions_total", nil)

	for k := 0; k < 6; k++ {
		add(fmt.Sprintf("spec_pos_accepted[position=%d]", k),
			"vllm:spec_decode_num_accepted_tokens_per_pos_total",
			map[string]string{"position": strconv.Itoa(k)})
	}
	return m
}

// valueOf returns the value of the first sample matching family `fam`
// (kv=nil matches any) — used to fetch pure unlabeled families and
// label-scoped counters.
func valueOf(samples []sample, fam string, kv map[string]string) float64 {
	for _, s := range samples {
		if s.name != fam {
			continue
		}
		if kv != nil {
			match := true
			for k, want := range kv {
				if s.labels[k] != want {
					match = false
					break
				}
			}
			if !match {
				continue
			}
		}
		return s.value
	}
	return 0
}

func parsePrometheusText(text string) []sample {
	var out []sample
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		var name string
		var labels map[string]string
		rest := line
		if i := strings.IndexByte(line, '{'); i >= 0 {
			name = line[:i]
			i2 := strings.IndexByte(line, '}')
			if i2 < 0 {
				continue
			}
			labels = map[string]string{}
			for _, kv := range strings.Split(line[i+1:i2], ",") {
				p := strings.SplitN(kv, "=", 2)
				if len(p) == 2 {
					labels[strings.TrimSpace(p[0])] = strings.Trim(p[1], `"`)
				}
			}
			rest = line[i2+1:]
		} else {
			parts := strings.Fields(line)
			if len(parts) == 2 {
				name = parts[0]
				rest = parts[1]
			} else {
				continue
			}
		}
		val, err := strconv.ParseFloat(strings.TrimSpace(rest), 64)
		if err != nil {
			continue
		}
		if labels == nil {
			labels = map[string]string{}
		}
		out = append(out, sample{name: name, labels: labels, value: val})
	}
	return out
}

// percentiles computes approximate p50/p90/p99 from a cumulative-bucket
// histogram family (le/count samples).
func percentiles(samples []sample, fam string) (p50, p90, p99 float64) {
	type b struct {
		le    float64
		count float64
	}
	var buckets []b
	var total float64
	for _, s := range samples {
		if !strings.HasPrefix(s.name, fam) {
			continue
		}
		switch {
		case strings.HasSuffix(s.name, "_bucket"):
			if le, ok := s.labels["le"]; ok && le != "+Inf" {
				if lf, err := strconv.ParseFloat(le, 64); err == nil {
					buckets = append(buckets, b{le: lf, count: s.value})
				}
			}
		case strings.HasSuffix(s.name, "_count"):
			total = s.value
		}
	}
	if total == 0 || len(buckets) == 0 {
		return 0, 0, 0
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].le < buckets[j].le })

	q := func(p float64) float64 {
		target := p / 100 * total
		if target <= 0 {
			return 0
		}
		for _, b := range buckets {
			if b.count >= target {
				return b.le
			}
		}
		return buckets[len(buckets)-1].le
	}
	return q(50), q(90), q(99)
}

// specPositions 返回本次抓取中实际出现的 spec-decode position（升序），
// 让 per-position 系列数量跟随 vLLM 配置，而非硬编码。
func specPositions(samples []sample) []int {
	set := make(map[int]struct{})
	for _, s := range samples {
		if s.name != "vllm:spec_decode_num_accepted_tokens_per_pos_total" {
			continue
		}
		if p, ok := s.labels["position"]; ok {
			if n, err := strconv.Atoi(p); err == nil {
				set[n] = struct{}{}
			}
		}
	}
	pos := make([]int, 0, len(set))
	for k := range set {
		pos = append(pos, k)
	}
	sort.Ints(pos)
	return pos
}
