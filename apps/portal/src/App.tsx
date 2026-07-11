import CambiarPassword from './components/CambiarPassword';
import Login from './components/Login';
import Shell from './components/Shell';
import Toast from './components/Toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

function Contenido() {
  const auth = useAuth();

  if (auth.cargando) {
    return (
      <main className="login-shell">
        <p className="eyebrow">Cargando...</p>
      </main>
    );
  }

  if (auth.usuario === null) return <Login />;
  if (auth.debeCambiarPassword) return <CambiarPassword />;
  return <Shell usuario={auth.usuario} />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Contenido />
        <Toast />
      </AuthProvider>
    </ToastProvider>
  );
}
