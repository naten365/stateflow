import { useState } from 'react';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured } from './supabaseClient';
import useSoftSounds from './useSoftSounds';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('login');
  const [message, setMessage] = useState(null);
  const { playType, playLeftClick } = useSoftSounds(true, 0.045);

  if (!isSupabaseConfigured) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">S</div>
            <h1>Stateflow</h1>
            <p>Configuracion pendiente</p>
          </div>
          <div className="login-error">
            Crea un archivo <strong>.env</strong> en la raiz del proyecto con tus credenciales de Supabase (renombra <strong>.env.example</strong> a <strong>.env</strong> y completa los valores).
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (mode === 'register' && password !== confirmPassword) {
      setError('Las contrasenas no coinciden.');
      return;
    }

    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        setMessage('Cuenta creada. Revisa tu correo para confirmar el registro.');
      }
    } catch (err) {
      setError('Correo o contrasena incorrectos.');
    }
  };

  const onKeyDown = (event) => {
    if (event.key.length === 1 || ['Backspace', 'Enter', 'Delete', ' '].includes(event.key)) {
      playType();
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">S</div>
          <h1>Stateflow</h1>
          <p>{mode === 'login' ? 'Inicia sesion para continuar' : 'Crea una cuenta nueva'}</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-label">
            Correo electronico
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="tu@correo.com"
              required
              autoComplete="email"
            />
          </label>

          <label className="login-label">
            Contrasena
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="••••••••"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
            />
          </label>

          {mode === 'register' && (
            <label className="login-label">
              Confirmar contrasena
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                minLength={8}
              />
            </label>
          )}

          {error && <p className="login-error">{error}</p>}
          {message && <p className="login-success">{message}</p>}

          <button type="submit" className="login-submit login-submit-font" onMouseDown={() => playLeftClick()}>
            {mode === 'login' ? 'Iniciar sesion' : 'Crear cuenta'}
          </button>
        </form>

        <p className="login-toggle">
          {mode === 'login' ? (
            <>
              ¿No tienes cuenta?{' '}
              <button type="button" onMouseDown={() => playLeftClick()} onClick={() => { setMode('register'); setError(null); setMessage(null); }}>
                Registrate
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{' '}
              <button type="button" onMouseDown={() => playLeftClick()} onClick={() => { setMode('login'); setError(null); setMessage(null); setConfirmPassword(''); }}>
                Inicia sesion
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
