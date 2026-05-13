import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthContext';
import useSoftSounds from './useSoftSounds';

export default function Dashboard({ onSelectProject, signOut, theme, setTheme }) {
  const { user } = useAuth();
  const { playType, playLeftClick } = useSoftSounds(true, 0.045);
  const [activeProjects, setActiveProjects] = useState([]);
  const [trashProjects, setTrashProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, description, created_at, updated_at, deleted_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (!error && data) {
      setActiveProjects(data.filter((p) => !p.deleted_at));
      setTrashProjects(data.filter((p) => p.deleted_at));
    }
    setLoading(false);
  };

  const createProject = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (newName.trim().length > 255) return;
    if (newDesc.trim().length > 500) return;

    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        name: newName.trim(),
        description: newDesc.trim(),
        pages: [{ id: 'page-1', title: 'Documento 1', x: 120, y: 90, html: '' }],
        elements: [],
        viewport: { x: 40, y: 34, zoom: 0.72 },
        active_page_id: 'page-1',
        document_font: 'excalifont',
        line_height: 1.68,
      })
      .select('id, name, description, created_at, updated_at')
      .single();

    if (!error && data) {
      setActiveProjects([data, ...activeProjects]);
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
    }
  };

  const moveToTrash = async (id, e) => {
    e.stopPropagation();
    playLeftClick();
    const { error } = await supabase
      .from('projects')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      const project = activeProjects.find((p) => p.id === id);
      if (project) {
        setActiveProjects(activeProjects.filter((p) => p.id !== id));
        setTrashProjects([{ ...project, deleted_at: new Date().toISOString() }, ...trashProjects]);
      }
    }
  };

  const restoreProject = async (id, e) => {
    e.stopPropagation();
    playLeftClick();
    const { error } = await supabase
      .from('projects')
      .update({ deleted_at: null })
      .eq('id', id);
    if (!error) {
      const project = trashProjects.find((p) => p.id === id);
      if (project) {
        setTrashProjects(trashProjects.filter((p) => p.id !== id));
        setActiveProjects([{ ...project, deleted_at: null }, ...activeProjects]);
      }
    }
  };

  const permanentDelete = async (id, e) => {
    e.stopPropagation();
    playLeftClick();
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (!error) setTrashProjects(trashProjects.filter((p) => p.id !== id));
  };

  const onKeyDown = (e) => {
    if (e.key.length === 1 || ['Backspace', 'Enter', 'Delete', ' '].includes(e.key)) playType();
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-header-left">
          <div className="brand-mark">S</div>
          <div>
            <strong>Stateflow</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="dashboard-btn ios-switch" type="button" aria-label="Cambiar tema" aria-pressed={theme === 'dark'} onClick={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}>
            <span />
          </button>
          <button className="dashboard-btn" onMouseDown={() => playLeftClick()} onClick={signOut}>
            Cerrar sesion
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-top">
          <h1>Mis proyectos</h1>
          <button
            className="dashboard-btn primary"
            onMouseDown={() => playLeftClick()}
            onClick={() => { setShowCreate(true); setNewName(''); setNewDesc(''); }}
          >
            + Nuevo proyecto
          </button>
        </div>

        {showCreate && (
          <form className="create-form" onSubmit={createProject}>
            <input
              type="text"
              placeholder="Nombre del proyecto"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              required
              maxLength={255}
            />
            <input
              type="text"
              placeholder="Descripcion (opcional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={500}
            />
            <div className="create-form-actions">
              <button type="submit" className="dashboard-btn primary" onMouseDown={() => playLeftClick()}>
                Crear
              </button>
              <button type="button" className="dashboard-btn" onMouseDown={() => playLeftClick()} onClick={() => setShowCreate(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="dashboard-empty">Cargando proyectos...</p>
        ) : activeProjects.length === 0 && trashProjects.length === 0 ? (
          <p className="dashboard-empty">Aun no tienes proyectos. Crea uno para empezar.</p>
        ) : (
          <>
            <div className="project-grid">
              {activeProjects.map((project) => (
                <div
                  key={project.id}
                  className="project-card"
                  onMouseDown={() => playLeftClick()}
                  onClick={() => onSelectProject(project.id)}
                >
                  <div className="project-card-body">
                    <h2>{project.name}</h2>
                    {project.description && <p>{project.description}</p>}
                  </div>
                  <div className="project-card-footer">
                    <span>{new Date(project.updated_at || project.created_at).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <button
                      className="project-delete"
                      onMouseDown={(e) => { e.stopPropagation(); playLeftClick(); }}
                      onClick={(e) => moveToTrash(project.id, e)}
                      title="Mover a papelera"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {trashProjects.length > 0 && (
              <div className="trash-section">
                <button className="trash-toggle" onClick={() => setShowTrash(!showTrash)}>
                  Papelera ({trashProjects.length}) {showTrash ? '▾' : '▸'}
                </button>
                {showTrash && (
                  <div className="project-grid trash-grid">
                    {trashProjects.map((project) => (
                      <div key={project.id} className="project-card trash-card">
                        <div className="project-card-body">
                          <h2>{project.name}</h2>
                          {project.description && <p>{project.description}</p>}
                        </div>
                        <div className="project-card-footer">
                          <span>Eliminado {new Date(project.deleted_at).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
                          <div className="trash-actions">
                            <button
                              className="project-delete"
                              onMouseDown={(e) => { e.stopPropagation(); playLeftClick(); }}
                              onClick={(e) => restoreProject(project.id, e)}
                              title="Restaurar"
                            >
                              ↺
                            </button>
                            <button
                              className="project-delete permanent-delete"
                              onMouseDown={(e) => { e.stopPropagation(); playLeftClick(); }}
                              onClick={(e) => permanentDelete(project.id, e)}
                              title="Eliminar permanentemente"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
