import { useEffect, useState } from 'react';
import { NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { AccountMenu } from './components/AccountMenu';
import { Icon, PageHeader, type IconName } from './components/ui';
import { DataProvider } from './data';
import { ActivityPage } from './pages/Activity';
import { AreaPage, AreasPage } from './pages/Areas';
import { Dashboard } from './pages/Dashboard';
import { ExpensePage, ExpensesPage } from './pages/Expenses';
import { InstallPage } from './pages/Install';
import { PaymentsPage } from './pages/Payments';
import { SettingsPage } from './pages/Settings';
import { SuppliersPage } from './pages/Suppliers';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'ראשי', icon: 'home' },
  { to: '/areas', label: 'תחומים', icon: 'areas' },
  { to: '/expenses', label: 'הוצאות', icon: 'expenses' },
  { to: '/payments', label: 'תשלומים', icon: 'payments' },
  { to: '/suppliers', label: 'ספקים', icon: 'suppliers' },
];

function Layout() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  const moreActive = ['/settings', '/install', '/activity'].some((p) => pathname.startsWith(p));
  return (
    <div className="app">
      <nav className="nav" aria-label="ניווט ראשי">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`nav-link ${moreActive ? 'active' : ''}`}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" />
          <span>עוד</span>
        </button>
      </nav>
      {menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} />}
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <DataProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="areas" element={<AreasPage />} />
          <Route path="areas/:id" element={<AreaPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="expenses/:id" element={<ExpensePage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="install" element={<InstallPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="*" element={<PageHeader title="הדף לא נמצא" back="/" />} />
        </Route>
      </Routes>
    </DataProvider>
  );
}
