package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// collectorState keeps deltas for derived rates (CPU, network bps).
type collectorState struct {
	prevCPU  cpuTimes
	prevNet  map[string]netStats
	prevTime time.Time
}

type cpuTimes struct {
	idle, total uint64
}

type netStats struct {
	rx, tx uint64
}

// collectHost gathers host-level metrics into a flat name→value map.
// Metric naming scheme:  host.<group>.<metric>
func (s *collectorState) collectHost() (map[string]float64, error) {
	out := make(map[string]float64)
	now := time.Now()

	// --- GPU (nvidia-smi) ---
	if gpu, err := gpuMetrics(); err == nil {
		for k, v := range gpu {
			out[k] = v
		}
	} else {
		out["host.gpu.present"] = 0
	}

	// --- CPU ---
	if c, ok := readCPUTimes(); ok {
		if !s.prevTime.IsZero() {
			dIdle := c.idle - s.prevCPU.idle
			dTot := c.total - s.prevCPU.total
			if dTot > 0 {
				out["host.cpu.util"] = 100 * (1 - float64(dIdle)/float64(dTot))
			}
		}
		s.prevCPU = c
	}
	if l1, l5, l15, ok := loadavg(); ok {
		out["host.load1"] = l1
		out["host.load5"] = l5
		out["host.load15"] = l15
	}

	// --- Memory ---
	if usedPct, usedGB, totalGB, ok := memInfo(); ok {
		out["host.mem.used_pct"] = usedPct
		out["host.mem.used_gb"] = usedGB
		out["host.mem.total_gb"] = totalGB
	}

	// --- Disk ---
	if usedPct, ok := diskUsage("/"); ok {
		out["host.disk.used_pct"] = usedPct
	}

	// --- Network bps (aggregate across all NICs, plus fabric ifaces) ---
	if n, ok := readNetStats(); ok {
		if s.prevNet != nil && !s.prevTime.IsZero() {
			dt := now.Sub(s.prevTime).Seconds()
			if dt > 0 {
				if c, has := n["all"]; has {
					if p, ok := s.prevNet["all"]; ok {
						out["host.net.rx_bps"] = float64(c.rx-p.rx) * 8 / dt
						out["host.net.tx_bps"] = float64(c.tx-p.tx) * 8 / dt
					}
				}
				// fabric NICs: enp1s0f0np0 / enp1s0f1np1 / enP2p1s0f0np0 / enP2p1s0f1np1
				for prefix := range fabricIfaces {
					if c, has := n[prefix]; has {
						if p, ok := s.prevNet[prefix]; ok {
							out["host.net."+prefix+".rx_bps"] = float64(c.rx-p.rx) * 8 / dt
							out["host.net."+prefix+".tx_bps"] = float64(c.tx-p.tx) * 8 / dt
						}
					}
				}
			}
		}
		s.prevNet = n
		s.prevTime = now
	}

	// --- RoCE ---
	if active, err := roceActive(); err == nil {
		out["host.roce.active"] = float64(active)
	}

	// --- vLLM container (docker stats) ---
	if cpuPct, memMB, ok := dockerContainerStats(); ok {
		out["host.container.cpu_pct"] = cpuPct
		out["host.container.mem_mb"] = memMB
	}

	return out, nil
}

var fabricIfaces = map[string]bool{
	"enp1s0f0np0": true, "enp1s0f1np1": true,
	"enP2p1s0f0np0": true, "enP2p1s0f1np1": true,
}

// ---- GPU ----
func gpuMetrics() (map[string]float64, error) {
	out := make(map[string]float64)
	cmd := exec.Command("nvidia-smi",
		"--query-gpu=name,utilization.gpu,temperature.gpu,power.draw,memory.used,memory.total,clocks.sm",
		"--format=csv,noheader,nounits")
	b, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	// 单 GPU 主机（DGX Spark GB10），忽略多行场景的后续行。
	line := strings.SplitN(strings.TrimSpace(string(b)), "\n", 2)[0]
	fields := strings.Split(line, ",")
	if len(fields) < 7 {
		return nil, fmt.Errorf("unexpected nvidia-smi output: %q", string(b))
	}
	out["host.gpu.present"] = 1
	out["host.gpu.util"] = atof(fields[1])
	out["host.gpu.temp_c"] = atof(fields[2])
	out["host.gpu.power_w"] = atof(fields[3])
	// GB10 为统一内存，memory.used/total 常返回 [N/A]；此时回退到
	// compute-apps 的每进程显存表求和，避免把真实占用记成 0。
	if usedMiB, ok := gpuMemNumeric(fields[4]); ok {
		out["host.gpu.mem_used_gb"] = usedMiB / 1024
	} else if usedMiB, ok := gpuMemFromApps(); ok {
		out["host.gpu.mem_used_gb"] = usedMiB / 1024
	}
	if totalMiB, ok := gpuMemNumeric(fields[5]); ok && totalMiB > 0 {
		out["host.gpu.mem_total_gb"] = totalMiB / 1024
		if used, ok := out["host.gpu.mem_used_gb"]; ok {
			out["host.gpu.mem_used_pct"] = used / (totalMiB / 1024) * 100
		}
	}
	out["host.gpu.sm_mhz"] = atof(fields[6])
	return out, nil
}

// gpuMemNumeric 解析 nvidia-smi 数字字段，显式拒绝 "N/A" 等非数字值。
func gpuMemNumeric(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" || strings.EqualFold(s, "N/A") {
		return 0, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

// gpuMemFromApps 汇总 compute-apps 表中的每进程显存（MiB）——统一内存
// GB10 上唯一可靠的显存来源。
func gpuMemFromApps() (float64, bool) {
	cmd := exec.Command("nvidia-smi", "--query-compute-apps=used_memory", "--format=csv,noheader,nounits")
	b, err := cmd.Output()
	if err != nil {
		return 0, false
	}
	sum := 0.0
	for _, l := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		if v, ok := gpuMemNumeric(l); ok {
			sum += v
		}
	}
	return sum, sum > 0
}

// ---- CPU ----
func readCPUTimes() (cpuTimes, bool) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuTimes{}, false
	}
	line := strings.SplitN(string(b), "\n", 2)[0]
	f := strings.Fields(line)[1:] // "cpu" user nice system idle iowait irq softirq steal
	if len(f) < 5 {
		return cpuTimes{}, false
	}
	var sums [2]uint64 // [0]=idle(4), [1]=total
	for i, v := range f {
		n, _ := strconv.ParseUint(v, 10, 64)
		if i == 3 { // idle
			sums[0] += n
		}
		sums[1] += n
	}
	return cpuTimes{idle: sums[0], total: sums[1]}, true
}

func loadavg() (float64, float64, float64, bool) {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, false
	}
	f := strings.Fields(string(b))
	if len(f) < 3 {
		return 0, 0, 0, false
	}
	return atof(f[0]), atof(f[1]), atof(f[2]), true
}

// ---- Memory (/proc/meminfo) ----
func memInfo() (usedPct, usedGB, totalGB float64, ok bool) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0, 0, false
	}
	var total, avail, free, buff, cache uint64
	sc := bufio.NewScanner(strings.NewReader(string(b)))
	for sc.Scan() {
		parts := strings.Fields(sc.Text())
		if len(parts) < 2 {
			continue
		}
		v, _ := strconv.ParseUint(parts[1], 10, 64)
		switch parts[0] {
		case "MemTotal:":
			total = v
		case "MemAvailable:":
			avail = v
		case "MemFree:":
			free = v
		case "Buffers:":
			buff = v
		case "Cached:":
			cache = v
		}
	}
	if total == 0 {
		return 0, 0, 0, false
	}
	if avail > 0 {
		used := total - avail
		return float64(used) / float64(total) * 100, float64(used) / 1e6, float64(total) / 1e6, true
	}
	_ = free
	_ = buff
	_ = cache
	used := total - (free + buff + cache)
	return float64(used) / float64(total) * 100, float64(used) / 1e6, float64(total) / 1e6, true
}

// ---- Disk (statfs on mount) ----
func diskUsage(path string) (float64, bool) {
	cmd := exec.Command("df", "-P", "-B1", path)
	b, err := cmd.Output()
	if err != nil {
		return 0, false
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) < 2 {
		return 0, false
	}
	f := strings.Fields(lines[1])
	if len(f) < 5 {
		return 0, false
	}
	used := atof(f[2])
	total := atof(f[1])
	if total <= 0 {
		return 0, false
	}
	return used / total * 100, true
}

// ---- Network (/proc/net/dev) ----
func readNetStats() (map[string]netStats, bool) {
	b, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil, false
	}
	out := make(map[string]netStats)
	var all netStats
	sc := bufio.NewScanner(strings.NewReader(string(b)))
	for sc.Scan() {
		line := sc.Text()
		i := strings.Index(line, ":")
		if i < 0 {
			continue
		}
		iface := strings.TrimSpace(line[:i])
		f := strings.Fields(line[i+1:])
		if len(f) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(f[0], 10, 64)
		tx, _ := strconv.ParseUint(f[8], 10, 64)
		out[iface] = netStats{rx: rx, tx: tx}
		all.rx += rx
		all.tx += tx
		// only track fabric ifaces explicitly
		if !fabricIfaces[iface] {
			delete(out, iface)
		}
	}
	out["all"] = all
	return out, true
}

// ---- RoCE ----
func roceActive() (int, error) {
	cmd := exec.Command("rdma", "link", "show")
	b, err := cmd.Output()
	if err != nil {
		return 0, err
	}
	n := 0
	for _, line := range strings.Split(string(b), "\n") {
		if strings.Contains(line, "state ACTIVE") && strings.Contains(line, "physical_state LINK_UP") {
			n++
		}
	}
	return n, nil
}

// ---- vLLM container (docker stats) ----
func dockerContainerStats() (cpuPct, memMB float64, ok bool) {
	cmd := exec.Command("docker", "stats", "--no-stream", "--format",
		"{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}")
	b, err := cmd.Output()
	if err != nil {
		return 0, 0, false
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	for _, line := range lines {
		if strings.Contains(line, "deepseek-v4-flash") {
			parts := strings.Split(line, "|")
			if len(parts) < 3 {
				continue
			}
			cpu := strings.TrimSuffix(strings.TrimSpace(parts[1]), "%")
			mem := strings.TrimSpace(parts[2])
			memVal := strings.Fields(mem)[0]
			memMB = parseMemToMB(memVal)
			return atof(cpu), memMB, true
		}
	}
	return 0, 0, false
}

func parseMemToMB(s string) float64 {
	u := strings.ToUpper(s)
	v := 0.0
	un := ""
	for i, c := range u {
		if (c >= '0' && c <= '9') || c == '.' {
			continue
		}
		v = atof(u[:i])
		un = strings.TrimSpace(strings.TrimSpace(u[i:]))
		break
	}
	if un == "" {
		return atof(u)
	}
	switch un {
	case "KIB", "KB":
		return v / 1024
	case "MIB", "MB":
		return v
	case "GIB", "GB":
		return v * 1024
	case "TIB", "TB":
		return v * 1024 * 1024
	}
	return v
}

func atof(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}
