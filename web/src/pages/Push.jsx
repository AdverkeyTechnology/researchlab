import { useState } from 'react';
import { LuBot, LuClipboardPaste, LuKeyRound, LuTerminal } from 'react-icons/lu';
import { api } from '../api.js';
import { Link } from '../router.jsx';
import { Button, CopyField, Spinner, timeAgo, useConfirm, useData, useToast } from '../ui.jsx';

export default function Push() {
  const toast = useToast();
  const confirm = useConfirm();
  const tokens = useData(() => api.get('/api/app/tokens'), []);
  const projects = useData(() => api.get('/api/app/projects'), []);
  const [newToken, setNewToken] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState('');

  if (tokens.loading || projects.loading) return <main className="wrap"><Spinner /></main>;
  const base = tokens.data.baseUrl;
  const list = projects.data.projects;
  const proj = slug || (list[0] && list[0].slug) || 'your-project-slug';
  const tok = newToken || 'rh_YOUR_TOKEN';

  const create = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api.post('/api/app/tokens', { name }); setNewToken(r.token); tokens.setData((d) => ({ ...d, tokens: r.tokens })); setName(''); }
    catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };
  const revoke = async (t) => {
    if (!(await confirm(`Revoke “${t.name}”? Anything using it will stop working.`, { action: 'Revoke' }))) return;
    tokens.setData({ ...tokens.data, tokens: (await api.del(`/api/app/tokens/${t.id}`)).tokens });
    toast('Token revoked');
  };

  const shell = `curl -s ${base}/push.sh -o push.sh && chmod +x push.sh
export RH_URL=${base} RH_TOKEN=${tok}

./push.sh ${proj} report.pdf "Q3 market sizing"     # any file type
pbpaste | ./push.sh ${proj} - "Notes from Claude"   # straight from the clipboard`;
  const agent = `When you finish the research, publish it to our Research Hub:

POST ${base}/api/v1/reports
Authorization: Bearer ${tok}
Content-Type: application/json

{
  "project": "${proj}",
  "title": "<short title>",
  "summary": "<one sentence>",
  "format": "markdown",          // or "html" for an interactive page
  "content": "<the full report>",
  "allowed": []                  // optional: only these member emails
}

To attach a file (PDF, image, deck), send multipart/form-data with
fields project, title and file instead. Reply with the "url" from the response.`;
  const curl = `curl -X POST ${base}/api/v1/reports \\
  -H "Authorization: Bearer ${tok}" \\
  -F project=${proj} -F title="Competitor landscape" \\
  -F file=@report.md`;

  return (
    <main className="wrap">
      <div className="head"><div><h1>Push research from an LLM</h1>
        <p>Three ways to get output from ChatGPT, Claude, Gemini or an agent onto the platform. The snippets below fill in your address, project and token.</p></div>
        {list.length > 1 && <label className="inline-select">Project <select value={proj} onChange={(e) => setSlug(e.target.value)}>{list.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>}
      </div>

      <div className="layout">
        <div className="card pad">
          <ol className="steps">
            <li><div className="step-icon"><LuClipboardPaste /></div><div>
              <h3>Paste it — no setup</h3>
              <p>Open a project → <strong>Add report</strong> → <strong>Paste from LLM</strong>. Paste the Markdown, or a full HTML page for interactive output. Tables, headings and links render properly; the first heading becomes the title.</p>
              {list[0] && <Link to={`/p/${proj}`}>Open {list.find((p) => p.slug === proj)?.name} →</Link>}
            </div></li>
            <li><div className="step-icon"><LuTerminal /></div><div>
              <h3>One command from your terminal</h3>
              <p>Create an API token on the right, then:</p>
              <CopyField value={shell} multiline />
              <p className="hint mt">Or with plain curl:</p>
              <CopyField value={curl} multiline />
            </div></li>
            <li><div className="step-icon"><LuBot /></div><div>
              <h3>Let the agent publish it itself</h3>
              <p>Add this to the end of the task for any agent that can make HTTP requests — Claude Code, ChatGPT custom actions, n8n, LangChain:</p>
              <CopyField value={agent} label="Copy instruction" multiline />
            </div></li>
          </ol>

          <h3 className="mt-lg">API reference</h3>
          <div className="table-scroll"><table className="t">
            <thead><tr><th>Endpoint</th><th>Does</th></tr></thead>
            <tbody>
              <tr><td><code>GET /api/v1/projects</code></td><td>List projects with members</td></tr>
              <tr><td><code>POST /api/v1/projects</code></td><td>Create — <code>{'{name, description, members}'}</code></td></tr>
              <tr><td><code>POST /api/v1/reports</code></td><td>Publish — JSON <code>{'{project, title, format, content}'}</code> or multipart with <code>file</code>; optional <code>summary</code>, <code>allowed</code></td></tr>
              <tr><td><code>GET /api/v1/projects/:slug/reports</code></td><td>List a project's reports</td></tr>
              <tr><td><code>GET /api/v1/reports/:id/comments</code></td><td>Read viewer comments — feed them back to the LLM</td></tr>
            </tbody>
          </table></div>
          <p className="hint">Every request needs <code>Authorization: Bearer &lt;token&gt;</code>. <code>project</code> accepts the slug, id or exact name.</p>
        </div>

        <aside className="side">
          <div className="card pad">
            <h3><LuKeyRound /> API tokens</h3>
            {newToken && <div className="flash mt-sm"><strong>Copy this token now</strong> — it won't be shown again.<div className="mt-sm"><CopyField value={newToken} label="Copy" /></div></div>}
            {tokens.data.tokens.map((t) => (
              <div className="member" key={t.id}><span className="e"><strong>{t.name}</strong><br /><span className="hint">{t.prefix}… · {t.lastUsed ? `used ${timeAgo(t.lastUsed)}` : 'never used'}</span></span>
                <button className="linkbtn danger" onClick={() => revoke(t)}>Revoke</button></div>
            ))}
            {!tokens.data.tokens.length && !newToken && <p className="hint">No tokens yet.</p>}
            <form onSubmit={create} className="mt">
              <label htmlFor="tn" className="first">New token</label>
              <input id="tn" required placeholder="e.g. Claude Code on my laptop" value={name} onChange={(e) => setName(e.target.value)} />
              <Button variant="primary" size="sm" className="mt" busy={busy}>Create token</Button>
            </form>
          </div>
          <div className="card pad"><h3>Project slugs</h3>
            {list.map((p) => <div className="member" key={p.slug}><span className="e">{p.name}</span><code>{p.slug}</code></div>)}
            {!list.length && <p className="hint">Create a project first.</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}
