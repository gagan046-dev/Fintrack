"use client";

import { UserProfile } from "@clerk/nextjs";
import { Bell, Check, CheckCheck, Copy, Mail, Plus, RefreshCw, RotateCcw, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useCurrencyFormatter } from "@/components/currency-context";

type HouseholdRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

type HouseholdData = {
  activeHouseholdId: string;
  role: HouseholdRole;
  households: Array<{ id: string; name: string; currency: string; role: HouseholdRole }>;
  members: Array<{ id: string; userId: string; name: string; email: string; role: HouseholdRole; joinedAt: string }>;
  invitations: Array<{ id: string; email: string; role: HouseholdRole; expiresAt: string }>;
};

type SettingsData = {
  name: string;
  email: string;
  currency: string;
  role: HouseholdRole;
  locale: string;
  weekStartsOn: number;
  emailNotifications: boolean;
  budgetAlerts: boolean;
  goalAlerts: boolean;
};

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};

export type DeletedTransaction = {
  id: string;
  merchant: string;
  description: string;
  category: string;
  amount: number;
  type: "expense" | "income";
  date: string;
  deletedAt: string | null;
};

async function apiMessage(response: Response, fallback: string) {
  try {
    const result = await response.json() as { error?: string; issues?: Record<string, string[]> };
    return Object.values(result.issues ?? {}).flat().find(Boolean) ?? result.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function HouseholdWorkspace() {
  const [data, setData] = useState<HouseholdData | null>(null);
  const [notice, setNotice] = useState("");
  const [inviteLink, setInviteLink] = useState("");

  async function load() {
    const response = await fetch("/api/households", { cache: "no-store" });
    if (!response.ok) throw new Error(await apiMessage(response, "Household could not be loaded."));
    const result = await response.json() as { data: HouseholdData };
    setData(result.data);
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/households", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiMessage(response, "Household could not be loaded."));
        return response.json() as Promise<{ data: HouseholdData }>;
      })
      .then((result) => { if (active) setData(result.data); })
      .catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, []);

  async function createHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/households", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), currency: form.get("currency") }),
    });
    if (!response.ok) return setNotice(await apiMessage(response, "Household could not be created."));
    window.location.reload();
  }

  async function switchHousehold(householdId: string) {
    const response = await fetch("/api/households/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId }),
    });
    if (!response.ok) return setNotice(await apiMessage(response, "Household could not be switched."));
    window.location.reload();
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch("/api/households/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
    });
    if (!response.ok) return setNotice(await apiMessage(response, "Invitation could not be created."));
    const result = await response.json() as { data: { invitePath: string } };
    setInviteLink(`${window.location.origin}${result.data.invitePath}`);
    formElement.reset();
    setNotice("Invitation created. Share the secure link with the recipient.");
    await load();
  }

  async function updateRole(id: string, role: HouseholdRole) {
    const response = await fetch(`/api/households/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!response.ok) return setNotice(await apiMessage(response, "Role could not be updated."));
    await load();
  }

  async function removeMember(id: string) {
    const response = await fetch(`/api/households/members/${id}`, { method: "DELETE" });
    if (!response.ok) return setNotice(await apiMessage(response, "Member could not be removed."));
    await load();
  }

  async function cancelInvitation(id: string) {
    const response = await fetch(`/api/households/invitations/${id}`, { method: "DELETE" });
    if (!response.ok) return setNotice(await apiMessage(response, "Invitation could not be cancelled."));
    await load();
  }

  const canAdmin = data ? ["OWNER", "ADMIN"].includes(data.role) : false;

  return (
    <section className="account-workspace">
      {notice && <div className="inline-notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
      <div className="account-grid">
        <section className="workspace-panel">
          <div className="section-header"><div><h2>Your households</h2><p>Switch between the financial spaces you belong to.</p></div><Users size={20} /></div>
          <div className="household-list">{data?.households.map((household) => <button className={household.id === data.activeHouseholdId ? "household-choice active" : "household-choice"} key={household.id} onClick={() => void switchHousehold(household.id)}><span><strong>{household.name}</strong><small>{household.currency} · {household.role.toLowerCase()}</small></span>{household.id === data.activeHouseholdId ? <Check size={17} /> : <RefreshCw size={15} />}</button>)}</div>
          <form className="compact-form" onSubmit={createHousehold}><label><span>New household</span><input name="name" placeholder="My household" required minLength={2} /></label><label><span>Currency</span><select name="currency" defaultValue="INR"><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option><option>AUD</option></select></label><button className="primary-button" type="submit"><Plus size={16} /> Create</button></form>
        </section>
        <section className="workspace-panel member-panel">
          <div className="section-header"><div><h2>Members</h2><p>Control access to the active household.</p></div><span className="role-badge">{data?.role.toLowerCase()}</span></div>
          <div className="member-list">{data?.members.map((member) => <article className="member-row" key={member.id}><div className="member-avatar">{member.name.slice(0, 2).toUpperCase()}</div><div><strong>{member.name}</strong><span>{member.email}</span></div>{canAdmin && member.role !== "OWNER" ? <select value={member.role} onChange={(event) => void updateRole(member.id, event.target.value as HouseholdRole)} aria-label={`Role for ${member.name}`}><option>ADMIN</option><option>MEMBER</option><option>VIEWER</option></select> : <span className="role-badge">{member.role.toLowerCase()}</span>}{canAdmin && member.role !== "OWNER" && <button className="delete-transaction" onClick={() => void removeMember(member.id)} aria-label={`Remove ${member.name}`}><Trash2 size={16} /></button>}</article>)}</div>
          {canAdmin && <form className="invite-form" onSubmit={inviteMember}><label><span>Invite by email</span><div><Mail size={16} /><input name="email" type="email" placeholder="person@example.com" required /></div></label><label><span>Role</span><select name="role" defaultValue="MEMBER">{data?.role === "OWNER" && <option>ADMIN</option>}<option>MEMBER</option><option>VIEWER</option></select></label><button className="primary-button" type="submit"><UserPlus size={16} /> Invite</button></form>}
          {inviteLink && <div className="invite-link"><input readOnly value={inviteLink} aria-label="Invitation link" /><button className="icon-button" onClick={() => void navigator.clipboard.writeText(inviteLink)} title="Copy invitation link"><Copy size={16} /></button></div>}
          {!!data?.invitations.length && <div className="pending-invites"><span>Pending invitations</span>{data.invitations.map((invitation) => <div key={invitation.id}><strong>{invitation.email}</strong><small>{invitation.role.toLowerCase()}</small><button onClick={() => void cancelInvitation(invitation.id)}>Cancel</button></div>)}</div>}
        </section>
      </div>
    </section>
  );
}

export function SettingsWorkspace() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/settings", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(await apiMessage(response, "Settings could not be loaded."));
      return response.json() as Promise<{ data: SettingsData }>;
    }).then((result) => { if (active) setSettings(result.data); }).catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    if (!response.ok) return setNotice(await apiMessage(response, "Settings could not be saved."));
    const result = await response.json() as { data: SettingsData };
    setSettings(result.data);
    setNotice("Settings saved.");
  }

  if (!settings) return <div className="empty-ledger"><strong>Loading settings</strong></div>;
  return <section className="settings-workspace"><form className="settings-form" onSubmit={save}><section className="workspace-panel"><div className="section-header"><div><h2>Profile and region</h2><p>Choose how FinTrack presents your financial information.</p></div></div><div className="settings-grid"><label><span>Name</span><input value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} /></label><label><span>Email</span><input value={settings.email} disabled /></label><label><span>Locale</span><select value={settings.locale} onChange={(event) => setSettings({ ...settings, locale: event.target.value })}><option value="en-US">English (United States)</option><option value="en-GB">English (United Kingdom)</option><option value="de-DE">German</option><option value="fr-FR">French</option></select></label><label><span>Currency</span><select value={settings.currency} disabled={!(["OWNER", "ADMIN"].includes(settings.role))} onChange={(event) => setSettings({ ...settings, currency: event.target.value })}><option>USD</option><option>EUR</option><option>GBP</option><option>INR</option><option>CAD</option><option>AUD</option></select></label><label><span>Week starts on</span><select value={settings.weekStartsOn} onChange={(event) => setSettings({ ...settings, weekStartsOn: Number(event.target.value) })}><option value={0}>Sunday</option><option value={1}>Monday</option></select></label></div></section><section className="workspace-panel"><div className="section-header"><div><h2>Alerts</h2><p>Control which progress updates FinTrack generates.</p></div></div><div className="toggle-list"><label><span><strong>Email notifications</strong><small>Allow important account updates by email.</small></span><input type="checkbox" checked={settings.emailNotifications} onChange={(event) => setSettings({ ...settings, emailNotifications: event.target.checked })} /></label><label><span><strong>Budget alerts</strong><small>Notify at 80% and when a limit is exceeded.</small></span><input type="checkbox" checked={settings.budgetAlerts} onChange={(event) => setSettings({ ...settings, budgetAlerts: event.target.checked })} /></label><label><span><strong>Goal milestones</strong><small>Notify at 50%, 75%, and completion.</small></span><input type="checkbox" checked={settings.goalAlerts} onChange={(event) => setSettings({ ...settings, goalAlerts: event.target.checked })} /></label></div></section><div className="settings-actions">{notice && <span>{notice}</span>}<button className="primary-button" type="submit"><Check size={16} /> Save settings</button></div></form></section>;
}

export function SecurityWorkspace({ authenticationEnabled }: { authenticationEnabled: boolean }) {
  return <section className="security-workspace"><div className="security-heading"><ShieldCheck size={23} /><div><h2>Account security</h2><p>Manage credentials, connected accounts, sessions, and account deletion.</p></div></div>{authenticationEnabled ? <UserProfile routing="hash" /> : <div className="workspace-panel"><strong>Development identity active</strong><p>Clerk account controls become available when managed authentication is enabled.</p></div>}</section>;
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  function notificationTime(createdAt: string) {
    return new Date(createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  async function load() {
    setError("");
    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (!response.ok) throw new Error(await apiMessage(response, "Notifications could not be loaded."));
    const result = await response.json() as { data: AppNotification[] };
    setNotifications(result.data);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/notifications", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiMessage(response, "Notifications could not be loaded."));
        return response.json() as Promise<{ data: AppNotification[] }>;
      })
      .then((result: { data: AppNotification[] }) => {
        if (active) setNotifications(result.data);
      })
      .catch((loadError: Error) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function markAllRead() {
    if (!unreadCount) return;
    setBusyAction("all");
    setError("");
    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!response.ok) throw new Error(await apiMessage(response, "Notifications could not be updated."));
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((notification) => ({ ...notification, readAt: notification.readAt ?? readAt })));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Notifications could not be updated.");
    } finally {
      setBusyAction(null);
    }
  }

  async function remove(id: string) {
    setBusyAction(id);
    setError("");
    try {
      const response = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await apiMessage(response, "Notification could not be removed."));
      setNotifications((current) => current.filter((notification) => notification.id !== id));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Notification could not be removed.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <aside className="notification-panel" aria-label="Notifications">
      <div className="notification-header">
        <div className="notification-title"><span className="notification-heading-icon"><Bell size={17} /></span><div><strong>Notifications</strong><span>{unreadCount ? `${unreadCount} unread` : "All caught up"}</span></div></div>
        <button className="icon-button" onClick={onClose} aria-label="Close notifications"><X size={18} /></button>
      </div>
      <div className="notification-actions">
        <span>Latest activity</span>
        <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount || busyAction === "all"}><CheckCheck size={14} /> Mark all read</button>
      </div>
      {error && <div className="notification-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>}
      <div className="notification-list">
        {loading ? <div className="notification-loading" role="status"><span /><span /><span /></div> : notifications.length ? notifications.map((notification) => (
          <article className={notification.readAt ? "notification-item" : "notification-item unread"} key={notification.id}>
            <span className="notification-state" aria-hidden="true" />
            <div className="notification-copy">
              <div className="notification-meta"><span>{notification.type.replaceAll("_", " ")}</span><time dateTime={notification.createdAt}>{notificationTime(notification.createdAt)}</time></div>
              <strong>{notification.title}</strong>
              <p>{notification.message}</p>
            </div>
            <button className="notification-delete" type="button" onClick={() => void remove(notification.id)} disabled={busyAction === notification.id} aria-label={`Delete ${notification.title}`} title="Delete notification"><Trash2 size={15} /></button>
          </article>
        )) : <div className="notification-empty"><span><Check size={22} /></span><strong>You are all caught up</strong><p>New budget, goal, and account updates will appear here.</p></div>}
      </div>
    </aside>
  );
}

export function TransactionTrash({ onRestored }: { onRestored: () => void }) {
  const { preciseCurrency } = useCurrencyFormatter();
  const [transactions, setTransactions] = useState<DeletedTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/transactions/trash", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(await apiMessage(response, "Deleted transactions could not be loaded."));
      return response.json() as Promise<{ data: DeletedTransaction[] }>;
    }).then((result) => { if (active) setTransactions(result.data); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function restore(id: string) {
    const response = await fetch(`/api/transactions/${id}/restore`, { method: "POST" });
    if (!response.ok) return;
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
    onRestored();
  }

  return <section className="trash-workspace"><div className="section-header"><div><h2>Recently deleted</h2><p>Restore transactions removed from the active ledger.</p></div><RotateCcw size={20} /></div>{loading ? <div className="empty-ledger"><strong>Loading deleted transactions</strong></div> : transactions.length ? <div className="trash-list">{transactions.map((transaction) => <article key={transaction.id}><div><strong>{transaction.merchant}</strong><span>{transaction.description} · {transaction.category}</span></div><div><strong>{preciseCurrency.format(transaction.amount)}</strong><span>Deleted {transaction.deletedAt ? new Date(transaction.deletedAt).toLocaleDateString() : "recently"}</span></div><button className="secondary-button" onClick={() => void restore(transaction.id)}><RotateCcw size={15} /> Restore</button></article>)}</div> : <div className="empty-ledger"><Check size={22} /><strong>Trash is empty</strong><span>Deleted transactions will appear here.</span></div>}</section>;
}