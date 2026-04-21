import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import GlobalView from './pages/GlobalView';
import ProjectDashboard from './pages/ProjectDashboard';
import InvalidToken from './pages/InvalidToken';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GlobalView />} />
        <Route path="/proyecto/:proyectoId" element={<ProjectDashboard />} />
        <Route path="/token-invalido" element={<InvalidToken />} />
        <Route path="*" element={<InvalidToken />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
