import { useState } from 'react';
import { useAuth } from './AuthContext';
import LoginPage from './LoginPage';
import Dashboard from './Dashboard';
import Editor from './Editor';

export default function App() {
  const { user, loading, signOut } = useAuth();
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [theme, setTheme] = useState('light');

  if (loading) {
    return <div className="loading-screen"><p>Cargando...</p></div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  if (!currentProjectId) {
    return (
      <div data-theme={theme}>
        <Dashboard onSelectProject={setCurrentProjectId} signOut={signOut} theme={theme} setTheme={setTheme} />
      </div>
    );
  }

  return (
    <div data-theme={theme}>
      <Editor projectId={currentProjectId} onBack={() => setCurrentProjectId(null)} user={user} theme={theme} setTheme={setTheme} />
    </div>
  );
}
