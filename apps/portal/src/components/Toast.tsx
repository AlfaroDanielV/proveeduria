import { useToast } from '../context/ToastContext';

export default function Toast() {
  const { mensaje } = useToast();
  if (mensaje === null) return null;
  return (
    <div className="toast" role="alert">
      {mensaje}
    </div>
  );
}
