package main

import (
	"database/sql"
	"log"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// store is the embedded time-series database (SQLite).
// Schema is deliberately simple and TS-oriented:
//   series(name, ts, val)  PK(name, ts), WITHOUT ROWID  — write-optimized append
//   latest(name, ts, val)  PK(name)                     — O(1) snapshot cache
//
// All reads for live views hit `latest`; history views hit `series` via the
// (name,ts) PK. Retention pruning removes rows older than the configured
// window; an hourly VACUUM keeps the file compact.
type store struct {
	db *sql.DB

	mu       sync.Mutex // guards lastWTs
	lastWTs  int64

	insSeries *sql.Stmt
	insLatest *sql.Stmt
}

func openStore(path string) (*store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// Practical settings for a local embedded store.
	_, _ = db.Exec(`PRAGMA journal_mode=WAL;`)
	_, _ = db.Exec(`PRAGMA synchronous=NORMAL;`)
	_, _ = db.Exec(`PRAGMA wal_autocheckpoint=1000;`)
	_, _ = db.Exec(`PRAGMA cache_size=-16384;`)
	_, _ = db.Exec(`
CREATE TABLE IF NOT EXISTS series(
  name TEXT NOT NULL,
  ts   INTEGER NOT NULL,
  val  REAL    NOT NULL,
  PRIMARY KEY(name, ts)
) WITHOUT ROWID;`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_series_ts ON series(ts);`)
	_, _ = db.Exec(`
CREATE TABLE IF NOT EXISTS latest(
  name TEXT PRIMARY KEY,
  ts   INTEGER NOT NULL,
  val  REAL    NOT NULL
) WITHOUT ROWID;`)

	insSeries, err := db.Prepare(`INSERT OR REPLACE INTO series(name, ts, val) VALUES(?,?,?)`)
	if err != nil {
		return nil, err
	}
	insLatest, err := db.Prepare(`INSERT OR REPLACE INTO latest(name, ts, val) VALUES(?,?,?)`)
	if err != nil {
		return nil, err
	}

	s := &store{db: db, insSeries: insSeries, insLatest: insLatest}
	s.readLastWrite()
	return s, nil
}

func (s *store) Close() error {
	if s.insSeries != nil {
		_ = s.insSeries.Close()
	}
	if s.insLatest != nil {
		_ = s.insLatest.Close()
	}
	return s.db.Close()
}

func (s *store) readLastWrite() {
	var ts sql.NullInt64
	_ = s.db.QueryRow(`SELECT MAX(ts) FROM series`).Scan(&ts)
	s.mu.Lock()
	s.lastWTs = ts.Int64
	s.mu.Unlock()
}

func (s *store) LastWrite() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastWTs
}

func (s *store) Count() int64 {
	var n int64
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM series`).Scan(&n)
	return n
}

// Insert batches points in a single transaction and updates the latest cache.
func (s *store) Insert(rows []row) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	st := tx.Stmt(s.insSeries)
	lt := tx.Stmt(s.insLatest)
	var maxTs int64
	for _, r := range rows {
		if _, err := st.Exec(r.Name, r.Ts, r.Val); err != nil {
			return err
		}
		if _, err := lt.Exec(r.Name, r.Ts, r.Val); err != nil {
			return err
		}
		if r.Ts > maxTs {
			maxTs = r.Ts
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.mu.Lock()
	s.lastWTs = maxTs
	s.mu.Unlock()
	return nil
}

// Prune removes rows older than cutoff and returns count removed.
func (s *store) Prune(cutoff int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM series WHERE ts < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	_, _ = s.db.Exec(`DELETE FROM latest WHERE ts < ?`, cutoff)
	if n > 50000 {
		_, _ = s.db.Exec(`VACUUM`)
	}
	return n, nil
}

// seriesInfo describes one metric series as exposed by /series.
type seriesInfo struct {
	Name string  `json:"name"`
	Ts   int64   `json:"ts"`
	Val  float64 `json:"val"`
}

func (s *store) ListSeries() []seriesInfo {
	rows, err := s.db.Query(`SELECT name, ts, val FROM latest ORDER BY name`)
	if err != nil {
		log.Printf("list series: %v", err)
		return nil
	}
	defer rows.Close()
	var out []seriesInfo
	for rows.Next() {
		var si seriesInfo
		if err := rows.Scan(&si.Name, &si.Ts, &si.Val); err != nil {
			continue
		}
		out = append(out, si)
	}
	return out
}

// point is a single (time, value) pair.
type point struct {
	Ts  int64   `json:"ts"`
	Val float64 `json:"val"`
}

func (s *store) Snapshot() map[string]float64 {
	rows, err := s.db.Query(`SELECT name, val FROM latest`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make(map[string]float64, 64)
	for rows.Next() {
		var n string
		var v float64
		if err := rows.Scan(&n, &v); err == nil {
			out[n] = v
		}
	}
	return out
}

// Range returns points for one metric in [from, to]; if step>0, averages
// points into step-sized buckets (unix seconds).
func (s *store) Range(name string, from, to, step int64) []point {
	q := `SELECT ts, val FROM series WHERE name = ? AND ts >= ? AND ts <= ? ORDER BY ts`
	args := []any{name, from, to}
	if step > 0 {
		q = `SELECT (ts / ?) * ?, AVG(val) FROM series WHERE name = ? AND ts >= ? AND ts <= ? GROUP BY ts / ? ORDER BY ts`
		args = []any{step, step, name, from, to, step}
	}
	rows, err := s.db.Query(q, args...)
	if err != nil {
		log.Printf("range %s: %v", name, err)
		return nil
	}
	defer rows.Close()
	var out []point
	for rows.Next() {
		var p point
		if err := rows.Scan(&p.Ts, &p.Val); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// Changes returns rows with ts in (since, now] plus the max ts encountered.
func (s *store) Changes(since, limit int64) ([]row, int64) {
	rows, err := s.db.Query(`SELECT name, ts, val FROM series WHERE ts > ? ORDER BY ts LIMIT ?`, since, limit)
	if err != nil {
		log.Printf("changes: %v", err)
		return nil, since
	}
	defer rows.Close()
	last := since
	var out []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.Name, &r.Ts, &r.Val); err == nil {
			out = append(out, r)
			if r.Ts > last {
				last = r.Ts
			}
		}
	}
	return out, last
}

var _ = time.Now
