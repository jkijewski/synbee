import { useCallback, useEffect, useState } from 'react';
import { ChecksPage } from './Checks';
import { SensorGroupsPage } from './SensorGroups';
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

type Page = 'devices' | 'rooms' | 'actions' | 'rules' | 'groups' | 'sensors' | 'checks' | 'pairing' | 'import' | 'gateway' | 'status' | 'members' | 'notifications';
const PAGES: Page[] = ['devices', 'rooms', 'actions', 'rules', 'groups', 'sensors', 'checks', 'pairing', 'import', 'gateway', 'status', 'members', 'notifications'];
const fromHash = (): Page => {
  const h = window.location.hash.slice(1).split('/')[0] as Page;
  return PAGES.includes(h) ? h : 'devices';
};
type AuthState = { setupRequired: boolean; signedIn: boolean };

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState('');
  const [page, setPageState] = useState<Page>(fromHash);
  const [adminOpen, setAdminOpen] = useState(false);
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

  // Everyday pages in the bar; setting up the hub under Administration. Light and sensor groups share one tab.
  const tabs: Array<[Page, string, Page[]]> = [
    ['devices', 'Devices', ['devices']],
    ['rooms', 'Rooms', ['rooms']],
    ['actions', 'Actions', ['actions']],
    ['rules', 'Automations', ['rules']],
    ['groups', 'Groups', ['groups', 'sensors']],
    ['checks', 'Checks', ['checks']],
    ['members', 'App users', ['members']],
  ];
  const admin: Array<[Page, string]> = [
    ['pairing', 'Add devices'],
    ['import', 'Import from Tuya'],
    ['gateway', 'Gateway'],
    ['status', 'Status'],
  ];
  const inAdmin = admin.some(([id]) => id === page);
  return (
    <>
      <header className="navbar bg-body-tertiary border-bottom px-3">
        <h1 className="navbar-brand mb-0 h1">SynBee</h1>
        <nav className="nav nav-pills">
          {tabs.map(([id, label, pages]) => (
            <button className={`nav-link${pages.includes(page) ? ' active' : ''}`} key={id} aria-current={pages.includes(page) ? 'page' : undefined} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
          <div className="dropdown" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setAdminOpen(false)}>
            <button className={`nav-link dropdown-toggle${inAdmin ? ' active' : ''}`} aria-expanded={adminOpen} onClick={() => setAdminOpen(!adminOpen)}>
              Administration
            </button>
            <ul className={`dropdown-menu${adminOpen ? ' show' : ''}`}>
              {admin.map(([id, label]) => (
                <li key={id}>
                  <button className={`dropdown-item${page === id ? ' active' : ''}`} onClick={() => (setPage(id), setAdminOpen(false))}>
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
        {(page === 'groups' || page === 'sensors') && (
          <>
            <nav className="nav nav-pills mb-2" aria-label="Kind of group">
              <button className={`nav-link${page === 'groups' ? ' active' : ''}`} onClick={() => setPage('groups')}>
                Light groups
              </button>
              <button className={`nav-link${page === 'sensors' ? ' active' : ''}`} onClick={() => setPage('sensors')}>
                Sensor groups
              </button>
            </nav>
            {page === 'groups' ? <Groups /> : <SensorGroupsPage />}
          </>
        )}
        {page === 'checks' && <ChecksPage />}
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
