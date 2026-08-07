import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getConfig, saveNode, deleteNode, type NodeCfg } from '../api/client';

interface Form {
  id: string;
  name: string;
  url: string;
  enabled: number;
}

const EMPTY: Form = { id: '', name: '', url: '', enabled: 1 };

const inputStyle: CSSProperties = {
  background: '#0e1320', border: '1px solid #2a3648', borderRadius: 6,
  color: '#d7dde8', padding: '6px 8px', fontSize: 12, outline: 'none',
};

export function Settings() {
  const [nodes, setNodes] = useState<NodeCfg[]>([]);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    void getConfig()
      .then(setNodes)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const startAdd = () => {
    setForm(EMPTY);
    setEditing('new');
    setErr('');
  };
  const startEdit = (n: NodeCfg) => {
    setForm({ id: n.id, name: n.name, url: n.url, enabled: n.enabled });
    setEditing(n.id);
    setErr('');
  };
  const cancel = () => {
    setEditing(null);
    setErr('');
  };

  const submit = async () => {
    setErr('');
    if (!form.id.trim() && editing === 'new') return setErr('需要填写节点 id');
    if (!form.url.trim() || !/^https?:\/\//.test(form.url.trim()))
      return setErr('url 必须以 http:// 或 https:// 开头');
    setSaving(true);
    try {
      if (editing === 'new') {
        await saveNode({
          id: form.id.trim(),
          name: form.name.trim(),
          url: form.url.trim(),
          enabled: form.enabled,
        });
      } else if (editing) {
        await saveNode({ id: editing, name: form.name.trim(), url: form.url.trim(), enabled: form.enabled });
      } else {
        return;
      }
      setEditing(null);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: NodeCfg) => {
    if (!window.confirm(`删除节点 ${n.id}？（仅移除配置，不影响机器上的 agent）`)) return;
    try {
      await deleteNode(n.id);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const toggle = async (n: NodeCfg) => {
    await saveNode({ id: n.id, enabled: n.enabled === 1 ? 0 : 1 });
    refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 快捷说明 */}
      <div
        style={{
          background: '#101828', border: '1px solid #1f2c42', borderRadius: 10,
          padding: '12px 16px', fontSize: 12, color: '#9fb0c8', lineHeight: 1.7,
        }}
      >
        在这里配置面板要拉取的机器（不是写在代码里）。步骤：① 在目标机器上装好 agent
        （见 GUIDE.md 第 3 步）② 点击「添加节点」，填 id 和 agent 地址 <code>http://&lt;IP&gt;:9100</code>
        ③ 保存后本页状态列会显示在线状态，其他页签立即开始出数据。
      </div>

      {err && (
        <div style={{ color: '#ef5350', fontSize: 12, background: '#2a1420', borderRadius: 8, padding: '8px 12px' }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#cfd8e6' }}>节点列表（{nodes.length}）</span>
        {editing === null && (
          <button
            onClick={startAdd}
            style={{ border: '1px solid #2f6f4f', background: '#123524', color: '#6ee7a8', borderRadius: 8, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}
          >
            + 添加节点
          </button>
        )}
      </div>

      {/* 编辑表单（新增/编辑共用） */}
      {editing !== null && (
        <div style={{ border: '1px solid #2a5a78', background: '#101c28', borderRadius: 10, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {editing === 'new' && (
            <label style={fieldStyle}>
              节点 id *
              <input style={inputStyle} value={form.id} placeholder="如 head / worker"
                onChange={(e) => setForm({ ...form, id: e.target.value })} />
            </label>
          )}
          <label style={fieldStyle}>
            名称
            <input style={{ ...inputStyle, width: 130 }} value={form.name} placeholder="显示名(可选)"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label style={{ ...fieldStyle, flex: '1 1 240px' }}>
            Agent 地址 *
            <input style={{ ...inputStyle, width: '100%' }} value={form.url} placeholder="http://192.168.x.x:9100"
              onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </label>
          <label style={fieldStyle}>
            启用
            <input type="checkbox" checked={form.enabled === 1} onChange={(e) => setForm({ ...form, enabled: e.target.checked ? 1 : 0 })} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submit} disabled={saving}
              style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontSize: 12, cursor: 'pointer' }}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={cancel}
              style={{ background: 'transparent', color: '#9fb0c8', border: '1px solid #2a3648', borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 节点表格 */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#7c8aa0', textAlign: 'left' }}>
              <th style={thStyle}>节点 id</th>
              <th style={thStyle}>名称</th>
              <th style={thStyle}>Agent 地址</th>
              <th style={thStyle}>状态</th>
              <th style={thStyle}>指标数</th>
              <th style={thStyle}>最近同步</th>
              <th style={thStyle}>启用</th>
              <th style={thStyle}>操作</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 && (
              <tr><td colSpan={8} style={{ color: '#7c8aa0', padding: 24, textAlign: 'center' }}>
                还没有节点 —— 点击「+ 添加节点」开始配置
              </td></tr>
            )}
            {nodes.map((n) => (
              <tr key={n.id} style={{ borderTop: '1px solid #1e2836' }}>
                <td style={tdStyle}><code style={{ color: '#4fc3f7' }}>{n.id}</code></td>
                <td style={tdStyle}>{n.name || '—'}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#9fb0c8' }}>{n.url}</td>
                <td style={tdStyle}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: n.ok ? '#6ee7a8' : '#ef5350' }} />
                    {n.ok ? '在线' : '离线'}
                    {n.hostname && <span style={{ color: '#7c8aa0' }}>({n.hostname})</span>}
                  </span>
                </td>
                <td style={tdStyle}>{n.series}</td>
                <td style={tdStyle}>
                  {n.lastOkTs ? `${Math.max(0, Math.round((Date.now() - n.lastOkTs) / 1000))}s 前` : '—'}
                </td>
                <td style={tdStyle}>
                  <input type="checkbox" checked={n.enabled === 1} onChange={() => void toggle(n)} />
                </td>
                <td style={tdStyle}>
                  <button onClick={() => startEdit(n)} style={btn}>编辑</button>
                  <button onClick={() => void remove(n)} style={{ ...btn, color: '#ef5350' }}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#7c8aa0',
};
const thStyle: CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const tdStyle: CSSProperties = { padding: '8px 10px', color: '#d7dde8', whiteSpace: 'nowrap' };
const btn: CSSProperties = {
  background: 'transparent', border: '1px solid #2a3648', color: '#9fb0c8',
  borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', marginRight: 6,
};
