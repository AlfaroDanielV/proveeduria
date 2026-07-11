import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const contenedor = document.getElementById('root');
if (contenedor === null) throw new Error('No se encontro el elemento #root.');

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
