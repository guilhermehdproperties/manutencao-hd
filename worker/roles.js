// Tipos de conta e cores das pessoas (sem vermelho nem verde, que são as cores do estado das tarefas).
import { forbidden } from './http.js';

export const ROLES = { admin: 'Administração', equipa: 'Equipa' };
export const COLORS = ['azul', 'laranja', 'roxo', 'turquesa', 'rosa', 'castanho', 'amarelo', 'cinzento'];

export const isAdmin = u => u.role === 'admin';
export function mustAdmin(u) { if (!isAdmin(u)) throw forbidden(); }

export const publicUser = u => ({ id: u.id, name: u.name, username: u.username, role: u.role, color: u.color, active: Boolean(u.active) });
