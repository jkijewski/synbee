import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { SignIn, Setup } from './Auth';
import { Actions } from './Actions';
import { Devices } from './devices/DeviceList';
import { Import } from './Import';
import { Pairing } from './Pairing';
import { Rules } from './rules/RulesPage';
import { Groups } from './Groups';
import { StatusPage } from './Status';
import { Rooms } from './Rooms';
import { Members } from './Members';
import { GatewayPage } from './Gateway';
import { Bell } from './notifications/Bell';
import { GatewayLight } from './notifications/GatewayLight';
import { NotificationsPage } from './notifications/NotificationsPage';

type Page = 'devices' | 'rooms' | 'actions' | 'rules' | 'groups' | 'pairing' | 'import' | 'gateway' | 'status' | 'members' | 'notifications';
const PAGES: Page[] = ['devices', 'rooms', 'actions', 'rules', 'groups', 'pairing', 'import', 'gateway', 'status', 'members', 'notifications'];
const fromHash = (): Page => {
  const h = window.location.hash.slice(1).split('/')[0] as Page;
  return PAGES.includes(h) ? h : 'devices';
};
type AuthState = { setupRequired: boolean; signedIn: boolean };

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState('');
  const [page, setPageState] = useState<Page>(fromHash);
  const setPage = (p: Page) => {
    window.location.hash = p;
    setPageState(p);
  };
  useEffect(() => {
    const on = () => setPageState(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const refresh = useCallback(() => {
    api<AuthState>('GET', '/api/auth/state').then(setAuth, (e: ApiError) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  if (error) return <p className="card card-body mb-3 narrow error">{error}</p>;
  if (!auth) return <p className="card card-body mb-3 narrow muted">Loading…</p>;
  if (auth.setupRequired) return <Setup onDone={refresh} />;
  if (!auth.signedIn) return <SignIn onDone={refresh} />;

  const tabs: Array<[Page, string]> = [
    ['devices', 'Devices'],
    ['rooms', 'Rooms'],
    ['actions', 'Actions'],
    ['rules', 'Automations'],
    ['groups', 'Light groups'],
    ['pairing', 'Add devices'],
    ['import', 'Import from Tuya'],
    ['gateway', 'Gateway'],
    ['members', 'App users'],
    ['status', 'Status'],
  ];
  return (
    <>
      <header className="navbar bg-body-tertiary border-bottom px-3">
        <h1 className="navbar-brand mb-0 h1">SynBee</h1>
        <nav className="nav nav-pills">
          {tabs.map(([id, label]) => (
            <button className={`nav-link${page === id ? ' active' : ''}`} key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="d-flex align-items-center">
          <GatewayLight />
          <Bell onOpen={() => setPage('notifications')} />
          <button className="btn btn-outline-secondary btn-sm" onClick={() => api('POST', '/api/auth/logout').finally(refresh)}>Sign out</button>
        </div>
      </header>
      <main>
        {page === 'devices' && <Devices />}
        {page === 'actions' && <Actions />}
        {page === 'rooms' && <Rooms />}
        {page === 'rules' && <Rules />}
        {page === 'groups' && <Groups />}
        {page === 'pairing' && <Pairing />}
        {page === 'gateway' && <GatewayPage />}
        {page === 'status' && <StatusPage />}
        {page === 'members' && <Members />}
        {page === 'notifications' && <NotificationsPage />}
        {page === 'import' && <Import />}
      </main>
    </>
  );
}
