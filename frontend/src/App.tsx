import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';

import { parseCsvRecipients, parseManualRecipients } from './lib/compose';

type DashboardTab = 'SCHEDULED' | 'SENT';
type SlackStatus = { connected: boolean; teamId: string | null };
type DashboardEmail = {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: DashboardTab | 'QUEUED' | 'FAILED';
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  sender: { id: string; displayName: string; emailAddress: string } | null;
};
type SenderSummary = { id: string; displayName: string; emailAddress: string; status?: string };

const backendOrigin = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const emailApiUrl = `${backendOrigin}/api`;

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function Icon({ name, size = 18 }: { name: 'spark' | 'clock' | 'send' | 'search' | 'refresh' | 'close' | 'arrow' | 'upload' | 'mail' | 'check'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    send: <><path d="m21 3-7.2 18-3.9-7.9L2 9.2 21 3Z" /><path d="M10 13 21 3" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M19 12a7.5 7.5 0 1 1-2-5.1L20 12" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    arrow: <><path d="M19 12H5m7 7-7-7 7-7" /></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Wordmark({ light = false }: { light?: boolean }) {
  return <div className={`wordmark${light ? ' wordmark-light' : ''}`}><span className="brand-mark"><Icon name="spark" size={19} /></span><span>reach<span className="wordmark-accent">inbox</span></span></div>;
}

function LoginPage({ onGoogleLogin, loading }: { onGoogleLogin: () => void; loading: boolean }) {
  return (
    <main className="login-screen">
      <section className="login-story">
        <div className="login-story-inner">
          <Wordmark light />
          <div className="story-copy">
            <p className="eyebrow"><span className="eyebrow-dot" /> A little more human, at scale</p>
            <h1>Good conversations<br />start with <span className="hand-underline">good timing.</span></h1>
            <p className="story-description">Thoughtful outreach, sent on your schedule. Keep every message personal, even when your list gets longer.</p>
          </div>
          <div className="doodle-stage" aria-hidden="true">
            <svg className="mail-doodle" viewBox="0 0 520 330" fill="none">
              <path className="doodle-line" d="M87 110c35-29 97-39 153-31 68 9 140 42 174 88 27 37 20 79-17 103-45 29-131 17-202-2-76-21-148-47-153-91-2-22 14-46 45-67Z" />
              <path className="doodle-line" d="m143 125 111 87 120-83" />
              <path className="doodle-line" d="M143 125v123h231V129" />
              <path className="doodle-accent" d="M184 276c47 22 114 28 167 11" />
              <path className="doodle-accent" d="m394 76 8-17 8 17 18 7-18 7-8 18-8-18-17-7 17-7Z" />
              <path className="doodle-line" d="M99 75c10-12 22-18 37-20m-4 14 7-14-15-2" />
              <circle className="doodle-dot" cx="420" cy="234" r="4" /><circle className="doodle-dot" cx="103" cy="260" r="3" />
              <path className="doodle-accent" d="M206 102c19-6 39-8 60-7" />
            </svg>
            <div className="doodle-note">A note, right on time <span>↗</span></div>
          </div>
          <div className="story-footer"><span>Designed for the follow-through.</span><span>01 — 03</span></div>
        </div>
      </section>
      <section className="login-main">
        <div className="login-mobile-brand"><Wordmark /></div>
        <div className="login-card">
          <div className="login-card-mark"><Icon name="spark" size={22} /></div>
          <p className="eyebrow">YOUR OUTREACH, IN GOOD HANDS</p>
          <h2>Welcome back</h2>
          <p className="login-subtitle">Sign in to pick up where your conversations left off.</p>
          <button type="button" onClick={onGoogleLogin} disabled={loading} className="google-button">
            <span className="google-g" aria-hidden="true">G</span>{loading ? 'Connecting…' : 'Continue with Google'}<Icon name="arrow" size={16} />
          </button>
          <div className="login-divider"><span /><span>Secure sign-in</span><span /></div>
          <p className="login-footnote">Your account is protected with Google sign-in. We’ll never send anything without your say-so.</p>
          <a href={`${backendOrigin}/health`} target="_blank" rel="noreferrer" className="health-link"><span className="health-dot" /> Check service status</a>
        </div>
        <div className="login-main-footer">A calmer way to keep in touch <span>✳</span></div>
      </section>
    </main>
  );
}

function DashboardPage({ user, onLogout }: { user: { id: string; email: string; name?: string | null }; onLogout: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('SCHEDULED');
  const [search, setSearch] = useState('');
  const [emails, setEmails] = useState<DashboardEmail[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [senders, setSenders] = useState<SenderSummary[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState('');
  const [recipientsInput, setRecipientsInput] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startTime, setStartTime] = useState(() => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
  const [delayMinutes, setDelayMinutes] = useState('5');
  const [hourlyLimit, setHourlyLimit] = useState('20');
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeSuccess, setComposeSuccess] = useState<string | null>(null);
  const [loadingSenders, setLoadingSenders] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackNotice, setSlackNotice] = useState<string | null>(null);

  const fetchEmails = async (tab: DashboardTab, query: string) => {
    try {
      setLoadingEmails(true);
      setError(null);
      const params = new URLSearchParams({ status: tab });
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`${emailApiUrl}/emails?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Your dashboard could not be loaded right now.');
      const data = await response.json();
      setEmails(data.emails ?? []);
    } catch (_error) {
      setEmails([]);
      setError('Unable to load your email dashboard.');
    } finally {
      setLoadingEmails(false);
    }
  };

  const fetchSlackStatus = async () => {
    try {
      setSlackLoading(true);
      const response = await fetch(`${emailApiUrl}/slack/status`, { credentials: 'include' });
      if (!response.ok) throw new Error('Slack connection status is unavailable.');
      const data = await response.json();
      setSlackStatus({ connected: Boolean(data.connected), teamId: data.teamId ?? null });
      setSlackError(null);
    } catch (_error) {
      setSlackStatus(null);
      setSlackError('Could not load Slack connection status.');
    } finally {
      setSlackLoading(false);
    }
  };

  const handleSlackConnect = async () => {
    try {
      setSlackLoading(true);
      setSlackError(null);
      const response = await fetch(`${emailApiUrl}/slack/connect`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.authUrl !== 'string') throw new Error(data.error ?? 'Could not start Slack authorization.');
      window.location.assign(data.authUrl);
    } catch (error) {
      setSlackError(error instanceof Error ? error.message : 'Could not start Slack authorization.');
      setSlackLoading(false);
    }
  };

  const handleSlackDisconnect = async () => {
    try {
      setSlackLoading(true);
      setSlackError(null);
      const response = await fetch(`${emailApiUrl}/slack/disconnect`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('Could not disconnect Slack.');
      setSlackStatus({ connected: false, teamId: null });
      setSlackNotice('Slack has been disconnected.');
    } catch (error) {
      setSlackError(error instanceof Error ? error.message : 'Could not disconnect Slack.');
    } finally {
      setSlackLoading(false);
    }
  };

  const fetchSenders = async () => {
    try {
      setLoadingSenders(true);
      const response = await fetch(`${emailApiUrl}/senders`, { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load sender list.');
      const data = await response.json();
      const nextSenders = (data.senders ?? []) as SenderSummary[];
      setSenders(nextSenders);
      if (nextSenders.length > 0 && !selectedSenderId) setSelectedSenderId(nextSenders[0].id);
      if (nextSenders.length === 0) {
        const defaultSenderResponse = await fetch(`${emailApiUrl}/senders`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: user.name ?? 'My Sender', emailAddress: user.email }),
        });
        if (defaultSenderResponse.ok) {
          const created = await defaultSenderResponse.json();
          const nextSender = created.sender as SenderSummary;
          setSenders([nextSender]);
          setSelectedSenderId(nextSender.id);
        }
      }
    } catch (_error) {
      setSenders([]);
      setSelectedSenderId('');
    } finally {
      setLoadingSenders(false);
    }
  };

  useEffect(() => { void fetchEmails(activeTab, search); }, [activeTab, search]);
  useEffect(() => { void fetchSenders(); }, [user.id]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectionResult = params.get('slack');
    const connectionError = params.get('slackError');
    if (connectionResult === 'connected') setSlackNotice('Slack connected. Rate-limit alerts can now reach your workspace.');
    if (connectionError) setSlackNotice(connectionError);
    if (connectionResult || connectionError) window.history.replaceState({}, '', window.location.pathname);
    void fetchSlackStatus();
  }, [user.id]);

  const summary = useMemo(() => ({
    total: emails.length,
    scheduled: emails.filter((email) => email.status === 'SCHEDULED').length,
    sent: emails.filter((email) => email.status === 'SENT').length,
    failed: emails.filter((email) => email.status === 'FAILED').length,
  }), [emails]);
  const recipientCount = parseManualRecipients(recipientsInput).valid.length;

  const handleCsvImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseCsvRecipients(text);
      if (result.valid.length === 0) {
        setComposeError('No valid recipient emails were found in the CSV file.');
        return;
      }
      const merged = Array.from(new Set([...parseManualRecipients(recipientsInput).valid, ...result.valid]));
      setRecipientsInput(merged.join('\n'));
      setComposeError(result.invalid.length > 0 ? `Imported ${result.valid.length} valid recipient(s). Invalid rows were skipped: ${result.invalid.slice(0, 5).join(', ')}` : null);
    } catch (_error) {
      setComposeError('CSV import failed. Please check the file format and try again.');
    } finally {
      event.target.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!selectedSenderId) { setComposeError('Please choose or create a sender before scheduling an email.'); return; }
    const { valid: recipients, invalid } = parseManualRecipients(recipientsInput);
    if (recipients.length === 0) { setComposeError(invalid.length > 0 ? `Invalid recipient email(s): ${invalid.slice(0, 5).join(', ')}` : 'Add at least one recipient before scheduling.'); return; }
    if (invalid.length > 0) { setComposeError(`Invalid recipient email(s): ${invalid.slice(0, 5).join(', ')}`); return; }
    if (!subject.trim() || !body.trim()) { setComposeError('Subject and body are required.'); return; }
    try {
      setIsSubmitting(true);
      setComposeError(null);
      setComposeSuccess(null);
      const response = await fetch(`${emailApiUrl}/emails/schedule`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: selectedSenderId, recipients, subject: subject.trim(), body: body.trim(), startTime: new Date(startTime).toISOString(), delayMinutes: Number(delayMinutes), hourlyLimit: Number(hourlyLimit) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'The email schedule could not be created.');
      setComposeSuccess(`Scheduled ${data.totalRecipients ?? recipients.length} email(s) successfully.`);
      setRecipientsInput(''); setSubject(''); setBody('');
      setStartTime(new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
      setDelayMinutes('5'); setHourlyLimit('20'); setIsComposeOpen(false);
      void fetchEmails(activeTab, search);
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : 'The email schedule could not be created.');
    } finally { setIsSubmitting(false); }
  };

  const initials = (user.name ?? user.email).split(/[\s@]/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Wordmark /><span className="brand-caption">Thoughtful mail, in motion</span></div>
        <button className="compose-button" type="button" onClick={() => { setComposeError(null); setIsComposeOpen(true); }}><Icon name="send" size={17} /> Compose new <span className="compose-plus">+</span></button>
        <div className="nav-label">YOUR MAIL</div>
        <nav className="mail-nav" aria-label="Email folders">
          <button type="button" className={`nav-item${activeTab === 'SCHEDULED' ? ' active' : ''}`} onClick={() => setActiveTab('SCHEDULED')}><Icon name="clock" /><span>Scheduled</span><span className="nav-count">{activeTab === 'SCHEDULED' ? summary.scheduled : '—'}</span></button>
          <button type="button" className={`nav-item${activeTab === 'SENT' ? ' active' : ''}`} onClick={() => setActiveTab('SENT')}><Icon name="send" /><span>Sent</span><span className="nav-count">{activeTab === 'SENT' ? summary.sent + summary.failed : '—'}</span></button>
        </nav>
        <section className="slack-card" aria-label="Slack integration">
          <div className="slack-card-heading"><span className={`slack-indicator${slackStatus?.connected ? ' connected' : ''}`} /><strong>Slack alerts</strong><span className="slack-card-spark">✳</span></div>
          <p>{slackLoading ? 'Checking connection…' : slackStatus?.connected ? `Connected${slackStatus.teamId ? ` · ${slackStatus.teamId}` : ''}` : slackError ?? 'Get a note when sending hits a limit.'}</p>
          <button type="button" onClick={() => slackStatus?.connected ? void handleSlackDisconnect() : void handleSlackConnect()} disabled={slackLoading} className={`slack-action${slackStatus?.connected ? ' disconnect' : ''}`}>
            {slackLoading ? 'Please wait…' : slackStatus?.connected ? 'Disconnect' : 'Connect Slack'}
          </button>
        </section>
        <div className="sidebar-doodle" aria-hidden="true"><svg viewBox="0 0 190 94" fill="none"><path d="M13 63c29-31 56 20 82-9 24-26 47-41 79-25"/><path d="m159 22 16 7-13 11"/><path d="M26 78c40-16 71 15 112-2"/></svg><span>Small steps,<br />good follow-ups.</span></div>
        <div className="sidebar-profile">
          <div className="avatar">{initials}</div>
          <div className="profile-copy"><strong>{user.name ?? 'Your account'}</strong><span>{user.email}</span></div>
          <button className="logout-button" type="button" onClick={onLogout} aria-label="Log out">↗</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>Mail</span><span className="breadcrumb-slash">/</span><strong>{activeTab === 'SCHEDULED' ? 'Scheduled' : 'Sent'}</strong></div>
          <div className="topbar-actions">
            <label className="search-box"><Icon name="search" size={17} /><span className="sr-only">Search emails</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages…" /></label>
            <button className="icon-button" type="button" onClick={() => void fetchEmails(activeTab, search)} aria-label="Refresh emails"><Icon name="refresh" /></button>
            <div className="avatar top-avatar" title={user.email}>{initials}</div>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><p className="eyebrow"><span className="eyebrow-dot" /> YOUR OUTREACH, AT A GLANCE</p><h1>{activeTab === 'SCHEDULED' ? <>A note for <span className="hand-underline">later.</span></> : <>Already <span className="hand-underline">sent.</span></>}</h1><p className="page-subtitle">{activeTab === 'SCHEDULED' ? 'Every message, lined up and ready for the right moment.' : 'A quiet record of the conversations you started.'}</p></div>
            <button className="primary-button" type="button" onClick={() => { setComposeError(null); setIsComposeOpen(true); }}><Icon name="send" size={16} /> Compose email</button>
          </div>

          {composeSuccess && <div className="success-banner" role="status"><span className="success-icon"><Icon name="check" size={15} /></span>{composeSuccess}<button type="button" onClick={() => setComposeSuccess(null)} aria-label="Dismiss"><Icon name="close" size={15} /></button></div>}
          {slackNotice && <div className={`success-banner${slackNotice.toLowerCase().includes('could not') || slackNotice.toLowerCase().includes('expired') || slackNotice.toLowerCase().includes('not completed') ? ' notice-error' : ''}`} role="status"><span className="success-icon"><Icon name="check" size={15} /></span>{slackNotice}<button type="button" onClick={() => setSlackNotice(null)} aria-label="Dismiss"><Icon name="close" size={15} /></button></div>}

          <section className="overview-strip" aria-label="Current view summary">
            <div className="overview-cell"><span className="overview-icon lavender"><Icon name="mail" size={17} /></span><div><span className="overview-label">In this view</span><strong>{summary.total}</strong></div></div>
            <span className="overview-divider" />
            <div className="overview-cell"><span className="overview-icon peach"><Icon name="clock" size={17} /></span><div><span className="overview-label">{activeTab === 'SCHEDULED' ? 'Waiting in line' : 'Delivered'}</span><strong>{activeTab === 'SCHEDULED' ? summary.scheduled : summary.sent}</strong></div></div>
            {activeTab === 'SENT' && <div className="overview-cell"><span className="overview-icon failed-icon"><Icon name="close" size={17} /></span><div><span className="overview-label">Failed</span><strong>{summary.failed}</strong></div></div>}
            <div className="overview-note"><span className="note-squiggle">〰</span> Your next thoughtful touch is on its way.</div>
          </section>

          <section className="message-section">
            <div className="list-heading"><div><h2>{activeTab === 'SCHEDULED' ? 'On the calendar' : 'Delivery history'}</h2><p>{activeTab === 'SCHEDULED' ? 'A little patience goes a long way.' : 'Messages sent successfully or marked failed.'}</p></div><div className="list-count">{loadingEmails ? 'Updating…' : `${emails.length} ${emails.length === 1 ? 'message' : 'messages'}`}</div></div>
            {error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => void fetchEmails(activeTab, search)}>Try again</button></div>}
            {loadingEmails ? <div className="loading-list" aria-label="Loading emails">{[1, 2, 3, 4].map((item) => <div className="loading-row" key={item}><span /><div><i /><i /></div></div>)}</div> : emails.length === 0 ? (
              <div className="empty-state"><div className="empty-illustration" aria-hidden="true"><svg viewBox="0 0 132 96" fill="none"><path d="M21 43c2-17 20-28 46-28 27 0 47 13 46 31-1 17-20 26-46 26-25 0-48-10-46-29Z"/><path d="m37 36 30 23 30-23M37 36v34h60V36"/><path d="m15 22 4-8 4 8 8 3-8 4-4 8-4-8-8-4 8-3Z"/><path d="m104 71 4-8 4 8 8 3-8 4-4 8-4-8-8-4 8-3Z"/></svg></div><h3>No {activeTab.toLowerCase()} emails yet</h3><p>{activeTab === 'SCHEDULED' ? 'When you schedule a note, it’ll find a home here.' : 'Your sent messages will gather here as you reach out.'}</p><button type="button" className="text-action" onClick={() => { setComposeError(null); setIsComposeOpen(true); }}>Write your first note <span>↗</span></button></div>
            ) : <div className="email-list">{emails.map((email, index) => <article className="email-row" key={email.id} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
              <div className={`email-avatar avatar-tone-${index % 4}`}>{email.recipientEmail.slice(0, 1).toUpperCase()}</div>
              <div className="email-main"><div className="email-recipient-line"><strong>To: {email.recipientEmail}</strong><span className={`status-pill status-${email.status.toLowerCase()}`}><span />{email.status.toLowerCase()}</span></div><div className="email-subject">{email.subject || 'No subject'}<span className="subject-preview"> — {email.body}</span></div><div className="email-meta">From {email.sender?.displayName ?? 'Unknown sender'} <span>·</span> {email.sender?.emailAddress ?? '—'}</div></div>
              <div className="email-date"><span className="date-mark"><Icon name={email.status === 'FAILED' ? 'close' : activeTab === 'SENT' ? 'send' : 'clock'} size={13} /></span>{email.status === 'FAILED' ? `Failed · ${formatDate(email.updatedAt)}` : formatDate(activeTab === 'SENT' ? email.sentAt : email.scheduledFor)}</div>
            </article>)}</div>}
          </section>
          <footer className="workspace-footer"><span>Made for the messages that matter.</span><span className="footer-spark">✳</span></footer>
        </div>
      </section>

      {isComposeOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsComposeOpen(false); }}><section className="compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <div className="compose-header"><button type="button" className="back-button" onClick={() => setIsComposeOpen(false)}><Icon name="arrow" size={17} /> Back</button><div className="compose-header-title"><span className="compose-title-mark"><Icon name="spark" size={17} /></span><div><h2 id="compose-title">Compose a note</h2><p>Write it once. We’ll help it arrive on time.</p></div></div><button type="button" className="modal-close" onClick={() => setIsComposeOpen(false)} aria-label="Close compose"><Icon name="close" /></button></div>
        <div className="compose-body">
          {composeError && <div className="error-banner compose-error" role="alert">{composeError}</div>}
          <div className="compose-form-row"><label className="field-label" htmlFor="sender-select">From</label><select id="sender-select" value={selectedSenderId} onChange={(event) => setSelectedSenderId(event.target.value)} className="field-control sender-select" disabled={loadingSenders}>{senders.length === 0 ? <option value="">{loadingSenders ? 'Loading senders…' : 'No sender available'}</option> : senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.displayName} · {sender.emailAddress}</option>)}</select></div>
          <div className="compose-form-row recipient-row"><label className="field-label" htmlFor="recipients-input">To</label><div className="recipient-field"><textarea id="recipients-input" value={recipientsInput} onChange={(event) => setRecipientsInput(event.target.value)} rows={2} placeholder="Add email addresses, separated by commas or new lines" className="field-control recipient-input" /><label htmlFor="csv-upload" className="upload-link"><Icon name="upload" size={15} /> Upload list</label><input id="csv-upload" className="visually-hidden" type="file" accept=".csv,text/csv" onChange={handleCsvImport} /><span className="recipient-count">{recipientCount} {recipientCount === 1 ? 'recipient' : 'recipients'}</span></div></div>
          <div className="compose-form-row"><label className="field-label" htmlFor="subject-input">Subject</label><input id="subject-input" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A subject worth opening" className="field-control" /></div>
          <div className="schedule-fields"><label className="stacked-field"><span>Start time</span><input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="field-control" /></label><label className="stacked-field"><span>Delay between emails <small>minutes</small></span><input type="number" min={0} max={1440} value={delayMinutes} onChange={(event) => setDelayMinutes(event.target.value)} className="field-control short-number" /></label><label className="stacked-field"><span>Hourly limit</span><input type="number" min={1} max={1000} value={hourlyLimit} onChange={(event) => setHourlyLimit(event.target.value)} className="field-control short-number" /></label></div>
          <label className="body-field"><span>Message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={8} placeholder="Type your note here… Make it sound like you." className="field-control message-input" /></label>
        </div>
        <div className="compose-footer"><span className="compose-footer-note"><span className="footer-spark">✳</span> A good note goes a long way.</span><button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting} className="primary-button schedule-button"><Icon name="clock" size={16} />{isSubmitting ? 'Scheduling…' : 'Schedule emails'}</button></div>
      </section></div>}
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<{ id: string; email: string; name?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchUser = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${emailApiUrl}/auth/me`, { credentials: 'include' });
      if (!response.ok) { setUser(null); return; }
      const data = await response.json();
      setUser(data.user ?? null);
    } catch (_error) { setUser(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void fetchUser(); }, []);
  const handleLogout = async () => {
    try { await fetch(`${emailApiUrl}/auth/logout`, { method: 'POST', credentials: 'include' }); }
    finally { setUser(null); }
  };
  const handleGoogleLogin = () => { window.location.assign(`${emailApiUrl}/auth/google/login`); };
  if (loading) return <main className="loading-screen"><Wordmark /><div className="loading-pencil" /><span>Getting your notes in order…</span></main>;
  return <Routes><Route path="/" element={user ? <DashboardPage user={user} onLogout={handleLogout} /> : <LoginPage onGoogleLogin={handleGoogleLogin} loading={false} />} /></Routes>;
}
