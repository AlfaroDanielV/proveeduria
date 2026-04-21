export default function InvalidToken() {
  return (
    <div className="min-h-full flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-center max-w-md">
        <div className="text-5xl mb-3">🔒</div>
        <h1 className="text-lg font-semibold text-slate-900">
          Enlace inválido o expirado
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          Pedile a un administrador que te genere un nuevo link desde WhatsApp.
        </p>
      </div>
    </div>
  );
}
