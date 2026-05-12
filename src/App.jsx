import { useCallback, useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const PAGE_WIDTH = 760;
const PAGE_HEIGHT = 980;
const fontSizes = [16, 18, 22, 28, 36, 48];
const colors = ['#1f1f1f', '#5f3dc4', '#1971c2', '#2f9e44', '#e67700', '#e03131'];
const fillColors = ['#ffffff', '#f8f9fa', '#fff4e6', '#e7f5ff', '#ebfbee', '#f3f0ff'];
const PROJECT_KEY = 'stateflow-project-v3';
const shapeTools = ['select', 'rect', 'circle', 'ellipse', 'line', 'arrow', 'triangle', 'diamond', 'polygon', 'pencil', 'text'];

const initialPages = [
  {
    id: 'page-1',
    title: 'Documento 1',
    x: 120,
    y: 90,
    html: '',
  },
];

const initialProject = {
  pages: initialPages,
  elements: [],
  viewport: { x: 40, y: 34, zoom: 0.72 },
  activePageId: 'page-1',
  documentFont: 'excalifont',
  lineHeight: 1.68,
};

const allowedHtmlTags = new Set(['B', 'I', 'U', 'STRONG', 'EM', 'BR', 'DIV', 'P', 'SPAN', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'FONT']);
const allowedStyleProps = new Set(['color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'line-height', 'font-family']);

function sanitizeInlineStyle(styleText) {
  return styleText
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawName, ...rawValue] = entry.split(':');
      const name = rawName?.trim().toLowerCase();
      const value = rawValue.join(':').trim();
      if (!allowedStyleProps.has(name) || !value) return '';
      if (/expression|javascript:|url\s*\(/i.test(value)) return '';
      if (name === 'font-size' && !/^\d{1,3}(\.\d+)?(px|rem|em|%)$/i.test(value)) return '';
      return `${name}: ${value}`;
    })
    .filter(Boolean)
    .join('; ');
}

function sanitizeHtml(html = '') {
  if (typeof document === 'undefined') return html;
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    if (!allowedHtmlTags.has(node.tagName)) {
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }

    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'class' || name === 'id') {
        node.removeAttribute(attribute.name);
        return;
      }
      if (name === 'style') {
        const safeStyle = sanitizeInlineStyle(attribute.value);
        if (safeStyle) node.setAttribute('style', safeStyle);
        else node.removeAttribute('style');
        return;
      }
      if (node.tagName === 'FONT' && name === 'size') return;
      node.removeAttribute(attribute.name);
    });
  });

  return template.innerHTML;
}

function colorWithAlpha(color, alpha = 1) {
  if (color === 'transparent' || alpha <= 0) return 'transparent';
  const normalized = color.replace('#', '');
  if (normalized.length !== 6) return color;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function loadInitialProject() {
  try {
    const stored = localStorage.getItem(PROJECT_KEY);
    if (!stored) return initialProject;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed.pages) || !Array.isArray(parsed.elements)) return initialProject;
    const pages = parsed.pages.map((page) => ({ ...page, html: sanitizeHtml(page.html || '') }));
    const activePageId = typeof parsed.activePageId === 'string' && pages.some((page) => page.id === parsed.activePageId)
      ? parsed.activePageId
      : pages[0]?.id ?? initialProject.activePageId;
    return {
      pages,
      elements: parsed.elements.map((element) => (
        element.type === 'text' ? { ...element, text: sanitizeHtml(element.text || '') } : element
      )),
      viewport: parsed.viewport && Number.isFinite(parsed.viewport.x) && Number.isFinite(parsed.viewport.y) && Number.isFinite(parsed.viewport.zoom)
        ? {
          x: parsed.viewport.x,
          y: parsed.viewport.y,
          zoom: Math.min(2.4, Math.max(0.24, parsed.viewport.zoom)),
        }
        : initialProject.viewport,
      activePageId,
      documentFont: parsed.documentFont === 'original' ? 'original' : 'excalifont',
      lineHeight: typeof parsed.lineHeight === 'number' && parsed.lineHeight >= 0.8 && parsed.lineHeight <= 4 ? parsed.lineHeight : initialProject.lineHeight,
    };
  } catch {
    return initialProject;
  }
}

function useSoftSounds(enabled, keyboardVolume) {
  const contextRef = useRef(null);
  const lastTypeSound = useRef(0);
  const lastPencilSound = useRef(0);
  const keyboardBufferRef = useRef(null);

  const playTone = useCallback((config) => {
    if (!enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = contextRef.current || new AudioContext();
    contextRef.current = context;
    if (context.state === 'suspended') context.resume();

    const now = context.currentTime;
    const output = context.createGain();
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(config.volume, now + 0.012);
    output.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);
    output.connect(context.destination);

    config.frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      oscillator.type = config.type ?? 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * config.slide, now + config.duration);
      filter.type = 'lowpass';
      filter.frequency.value = config.filter + index * 120;
      oscillator.connect(filter);
      filter.connect(output);
      oscillator.start(now);
      oscillator.stop(now + config.duration + 0.02);
    });
  }, [enabled]);

  const playType = useCallback(() => {
    const now = performance.now();
    if (!enabled || now - lastTypeSound.current < 42) return;
    lastTypeSound.current = now;
    const context = contextRef.current;
    const buffer = keyboardBufferRef.current;
    if (!context || !buffer) return;
    if (context.state === 'suspended') context.resume();

    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    filter.type = 'lowpass';
    filter.frequency.value = 3600 + Math.random() * 800;
    gain.gain.value = keyboardVolume * (0.72 + Math.random() * 0.18);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();
    source.stop(context.currentTime + 0.105);
  }, [enabled, keyboardVolume]);

  const playLeftClick = useCallback(() => {
    playTone({ frequencies: [360, 740], duration: 0.07, volume: 0.021, filter: 1200, type: 'sine', slide: 1.04 });
  }, [playTone]);

  const playRightClick = useCallback(() => {
    playTone({ frequencies: [220, 430], duration: 0.095, volume: 0.019, filter: 940, type: 'sine', slide: 0.84 });
  }, [playTone]);

  const playPencil = useCallback(() => {
    const now = performance.now();
    if (!enabled || now - lastPencilSound.current < 70) return;
    lastPencilSound.current = now;
    playTone({ frequencies: [920 + Math.random() * 80], duration: 0.075, volume: 0.009, filter: 1800, type: 'triangle', slide: 0.96 });
  }, [enabled, playTone]);

  useEffect(() => {
    if (!enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = contextRef.current || new AudioContext();
    contextRef.current = context;
    let cancelled = false;

    fetch('/audio/mechanical-keyboard.mp3')
      .then((response) => response.arrayBuffer())
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        if (!cancelled) keyboardBufferRef.current = buffer;
      })
      .catch(() => {
        keyboardBufferRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { playType, playPencil, playLeftClick, playRightClick };
}

function App() {
  const initialProjectRef = useRef(loadInitialProject());
  const stageRef = useRef(null);
  const editorRefs = useRef({});
  const textElementRefs = useRef({});
  const pageHtmlRef = useRef(Object.fromEntries(initialProjectRef.current.pages.map((page) => [page.id, page.html])));
  const savedSelection = useRef(null);
  const dragRef = useRef(null);
  const pointerRef = useRef(null);
  const pagesRef = useRef(initialProjectRef.current.pages);
  const elementsRef = useRef(initialProjectRef.current.elements);
  const viewportRef = useRef(initialProjectRef.current.viewport);
  const activePageIdRef = useRef(initialProjectRef.current.activePageId);
  const documentFontRef = useRef(initialProjectRef.current.documentFont);
  const lineHeightRef = useRef(initialProjectRef.current.lineHeight ?? 1.68);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const activePointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const textEditSessionRef = useRef(null);
  const saveTimerRef = useRef(null);
  const [pages, setPages] = useState(initialProjectRef.current.pages);
  const [elements, setElements] = useState(initialProjectRef.current.elements);
  const [selectedElementIds, setSelectedElementIds] = useState([]);
  const [activeTool, setActiveTool] = useState('select');
  const [editingTextId, setEditingTextId] = useState(null);
  const [activePageId, setActivePageId] = useState(initialProjectRef.current.activePageId ?? initialProjectRef.current.pages[0]?.id ?? 'page-1');
  const [mode, setMode] = useState('canvas');
  const modeRef = useRef(mode);
  const [viewport, setViewport] = useState(initialProjectRef.current.viewport ?? { x: 40, y: 34, zoom: 0.72 });
  const [fontSize, setFontSize] = useState(22);
  const [textColor, setTextColor] = useState('#1f1f1f');
  const [documentFont, setDocumentFont] = useState(initialProjectRef.current.documentFont ?? 'excalifont');
  const [theme, setTheme] = useState('light');
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [keyboardVolume, setKeyboardVolume] = useState(0.045);
  const [printingPageId, setPrintingPageId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'saved', error: null, savedAt: null });
  const [editorRenderVersion, setEditorRenderVersion] = useState(0);
  const [lineHeight, setLineHeight] = useState(initialProjectRef.current.lineHeight ?? 1.68);
  const { playType, playPencil, playLeftClick, playRightClick } = useSoftSounds(soundsEnabled, keyboardVolume);

  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const selectedTextElements = elements.filter((element) => selectedElementIds.includes(element.id) && element.type === 'text');
  const primaryTextElement = selectedTextElements[0] ?? null;
  const saveStatusText = saveState.status === 'saving'
    ? 'Guardando...'
    : saveState.status === 'error'
      ? 'Error al guardar'
      : saveState.savedAt
        ? `Guardado ${saveState.savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Guardado';

  const serializeProject = useCallback((sourcePages = pagesRef.current, sourceElements = elementsRef.current) => ({
    pages: sourcePages.map((page) => ({
      ...page,
      html: sanitizeHtml(pageHtmlRef.current[page.id] ?? page.html ?? ''),
    })),
    elements: sourceElements.map((element) => (
      element.type === 'text' ? { ...element, text: sanitizeHtml(element.text || '') } : element
    )),
    viewport: viewportRef.current,
    activePageId: activePageIdRef.current,
    documentFont: documentFontRef.current,
    lineHeight: lineHeightRef.current,
  }), []);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    setSaveState((current) => ({ ...current, status: 'saving', error: null }));
    saveTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(PROJECT_KEY, JSON.stringify(serializeProject()));
        setSaveState({ status: 'saved', error: null, savedAt: new Date() });
      } catch (error) {
        setSaveState({ status: 'error', error: error?.message || 'No se pudo guardar', savedAt: null });
      }
    }, 180);
  }, [serializeProject]);

  useEffect(() => {
    pagesRef.current = pages;
    elementsRef.current = elements;
    scheduleSave();
    return () => window.clearTimeout(saveTimerRef.current);
  }, [pages, elements, scheduleSave]);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    viewportRef.current = viewport;
    scheduleSave();
  }, [scheduleSave, viewport]);

  useEffect(() => {
    activePageIdRef.current = activePageId;
    scheduleSave();
  }, [activePageId, scheduleSave]);

  useEffect(() => {
    documentFontRef.current = documentFont;
    scheduleSave();
  }, [documentFont, scheduleSave]);

  useEffect(() => {
    lineHeightRef.current = lineHeight;
    scheduleSave();
  }, [lineHeight, scheduleSave]);

  const snapshotProject = useCallback(() => ({
    ...serializeProject(),
  }), [serializeProject]);

  const recordHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-59), snapshotProject()];
    futureRef.current = [];
  }, [snapshotProject]);

  const restoreProject = useCallback((snapshot) => {
    setPages(snapshot.pages);
    setElements(snapshot.elements);
    pageHtmlRef.current = Object.fromEntries(snapshot.pages.map((page) => [page.id, page.html || '']));
    setSelectedElementIds([]);
    setEditingTextId(null);
    setContextMenu(null);
    textEditSessionRef.current = null;
    setEditorRenderVersion((version) => version + 1);
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current = [snapshotProject(), ...futureRef.current.slice(0, 59)];
    restoreProject(previous);
  }, [restoreProject, snapshotProject]);

  const redo = useCallback(() => {
    const next = futureRef.current.shift();
    if (!next) return;
    historyRef.current = [...historyRef.current.slice(-59), snapshotProject()];
    restoreProject(next);
  }, [restoreProject, snapshotProject]);

  const saveSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const editor = editorRefs.current[activePageId];
    if (!editor?.contains(selection.anchorNode)) return;
    savedSelection.current = selection.getRangeAt(0).cloneRange();
  }, [activePageId]);

  const restoreSelection = useCallback(() => {
    const selection = window.getSelection();
    const range = savedSelection.current;
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const focusPage = useCallback((pageId) => {
    const page = pages.find((item) => item.id === pageId);
    const stage = stageRef.current;
    if (!page || !stage) return;
    const rect = stage.getBoundingClientRect();
    setActivePageId(pageId);
    setMode('writing');
    setViewport({
      zoom: 1,
      x: (rect.width - PAGE_WIDTH) / 2 - page.x,
      y: 34 - page.y,
    });
    window.setTimeout(() => editorRefs.current[pageId]?.focus(), 360);
  }, [pages]);

  const centerPage = useCallback((page, nextZoom = 1) => {
    const stage = stageRef.current;
    if (!page || !stage) return;
    const rect = stage.getBoundingClientRect();
    setViewport({
      zoom: nextZoom,
      x: (rect.width - PAGE_WIDTH * nextZoom) / 2 - page.x * nextZoom,
      y: 34 - page.y * nextZoom,
    });
  }, []);

  const keepPageInView = useCallback((page, currentViewport) => {
    const stage = stageRef.current;
    if (!page || !stage) return currentViewport;
    const rect = stage.getBoundingClientRect();
    const margin = Math.min(72, Math.max(28, rect.width * 0.06));
    const minVisible = 120;
    const zoom = currentViewport.zoom;
    const pageLeft = currentViewport.x + page.x * zoom;
    const pageTop = currentViewport.y + page.y * zoom;
    const pageRight = pageLeft + PAGE_WIDTH * zoom;
    const pageBottom = pageTop + PAGE_HEIGHT * zoom;
    const visibleW = Math.min(pageRight, rect.width - margin) - Math.max(pageLeft, margin);
    const visibleH = Math.min(pageBottom, rect.height - margin) - Math.max(pageTop, margin);

    if (visibleW >= minVisible && visibleH >= minVisible) return currentViewport;

    let x = currentViewport.x;
    let y = currentViewport.y;
    if (pageRight < margin + minVisible) x += margin + minVisible - pageRight;
    if (pageLeft > rect.width - margin - minVisible) x -= pageLeft - (rect.width - margin - minVisible);
    if (pageBottom < margin + minVisible) y += margin + minVisible - pageBottom;
    if (pageTop > rect.height - margin - minVisible) y -= pageTop - (rect.height - margin - minVisible);

    return { ...currentViewport, x, y };
  }, []);

  const exitWriting = useCallback(() => {
    if (mode !== 'writing') return;
    setMode('canvas');
    const page = pagesRef.current.find((item) => item.id === activePageIdRef.current);
    setViewport((current) => keepPageInView(page, current));
    window.getSelection()?.removeAllRanges();
  }, [keepPageInView, mode]);

  const focusEditor = useCallback(() => {
    editorRefs.current[activePageId]?.focus();
    restoreSelection();
  }, [activePageId, restoreSelection]);

  const runCommand = useCallback((command, value = null) => {
    if (mode !== 'writing') return;
    focusEditor();
    document.execCommand(command, false, value);
    saveSelection();
  }, [focusEditor, mode, saveSelection]);

  const syncEditorHtml = useCallback((pageId = activePageId) => {
    const editor = editorRefs.current[pageId];
    if (!editor) return;
    const html = sanitizeHtml(editor.innerHTML);
    pageHtmlRef.current[pageId] = html;
    setPages((items) => items.map((page) => (page.id === pageId ? { ...page, html } : page)));
  }, [activePageId]);

  const applyFontSize = useCallback((size) => {
    setFontSize(size);
    if (mode === 'writing') recordHistory();
    runCommand('fontSize', '4');
    const editor = editorRefs.current[activePageId];
    const sizedNodes = editor?.querySelectorAll('font[size="4"]') ?? [];
    sizedNodes.forEach((node) => {
      const span = document.createElement('span');
      span.style.fontSize = `${size}px`;
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    });
    syncEditorHtml(activePageId);
  }, [activePageId, mode, recordHistory, runCommand, syncEditorHtml]);

  const applyColor = useCallback((color) => {
    setTextColor(color);
    if (mode !== 'writing') return;
    focusEditor();
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      recordHistory();
      const range = sel.getRangeAt(0);
      try {
        const fragment = range.extractContents();
        const span = document.createElement('span');
        span.style.color = color;
        span.appendChild(fragment);
        range.insertNode(span);
        range.collapse(false);
      } catch {
        // Fallback for edge cases
        document.execCommand('foreColor', false, color);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }
    syncEditorHtml(activePageId);
    saveSelection();
  }, [activePageId, focusEditor, mode, recordHistory, saveSelection, syncEditorHtml]);

  const applyFont = useCallback((fontFamily) => {
    if (mode !== 'writing') return;
    focusEditor();
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      recordHistory();
      const range = sel.getRangeAt(0);
      try {
        const fragment = range.extractContents();
        const span = document.createElement('span');
        span.style.fontFamily = fontFamily;
        span.appendChild(fragment);
        range.insertNode(span);
        range.collapse(false);
      } catch {
        document.execCommand('fontName', false, fontFamily);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }
    syncEditorHtml(activePageId);
    saveSelection();
  }, [activePageId, focusEditor, mode, recordHistory, saveSelection, syncEditorHtml]);

  const createPage = useCallback(() => {
    recordHistory();
    const id = crypto.randomUUID();
    const nextPage = {
      id,
      title: `Documento ${pages.length + 1}`,
      x: activePage.x + 120,
      y: activePage.y + 120,
      html: '',
    };
    pageHtmlRef.current[id] = nextPage.html;
    setPages((items) => [...items, nextPage]);
    setActivePageId(id);
    setMode('writing');
    centerPage(nextPage, 1);
    window.setTimeout(() => editorRefs.current[id]?.focus(), 120);
  }, [activePage, centerPage, pages.length, recordHistory]);

  const duplicatePage = useCallback((pageId = activePageId) => {
    const page = pages.find((item) => item.id === pageId);
    if (!page) return;
    recordHistory();
    const id = crypto.randomUUID();
    const copy = { ...page, id, html: pageHtmlRef.current[page.id] || page.html, title: `${page.title} copia`, x: page.x + 90, y: page.y + 90 };
    pageHtmlRef.current[id] = copy.html;
    setPages((items) => [...items, copy]);
    setActivePageId(id);
  }, [activePageId, pages, recordHistory]);

  const deletePage = useCallback((pageId = activePageId) => {
    recordHistory();
    setPages((items) => {
      if (items.length <= 1) return items;
      const next = items.filter((page) => page.id !== pageId);
      delete pageHtmlRef.current[pageId];
      setActivePageId(next[0].id);
      setMode('canvas');
      return next;
    });
  }, [activePageId, recordHistory]);

  const updatePageHtml = useCallback((pageId, html) => {
    if (textEditSessionRef.current !== pageId) {
      recordHistory();
      textEditSessionRef.current = pageId;
    }
    pageHtmlRef.current[pageId] = html;
    scheduleSave();
  }, [recordHistory, scheduleSave]);

  const commitPageHtml = useCallback((pageId) => {
    const html = sanitizeHtml(pageHtmlRef.current[pageId] ?? '');
    pageHtmlRef.current[pageId] = html;
    const editor = editorRefs.current[pageId];
    if (editor && editor.innerHTML !== html) editor.innerHTML = html;
    setPages((items) => items.map((page) => (page.id === pageId ? { ...page, html } : page)));
  }, []);

  const htmlFromPlainText = useCallback((text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\r?\n/g, '<br>');
  }, []);

  const pasteCleanHtml = useCallback((event, pageId = activePageId) => {
    event.preventDefault();
    const clipboard = event.clipboardData;
    const html = clipboard?.getData('text/html');
    const text = clipboard?.getData('text/plain') || '';
    const safeHtml = sanitizeHtml(html || htmlFromPlainText(text));
    if (!safeHtml) return;
    if (textEditSessionRef.current !== pageId) {
      recordHistory();
      textEditSessionRef.current = pageId;
    }
    document.execCommand('insertHTML', false, safeHtml);
    syncEditorHtml(pageId);
    saveSelection();
  }, [activePageId, htmlFromPlainText, recordHistory, saveSelection, syncEditorHtml]);

  const clientToWorld = useCallback((event) => {
    const stage = stageRef.current;
    const rect = stage.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
    };
  }, [viewport]);

  const getPagePoint = useCallback((event, pageId = null) => {
    const worldPoint = clientToWorld(event);
    const page = pageId
      ? pages.find((item) => item.id === pageId)
      : pages.find((item) => (
        worldPoint.x >= item.x
        && worldPoint.x <= item.x + PAGE_WIDTH
        && worldPoint.y >= item.y
        && worldPoint.y <= item.y + 980
      ));
    if (!page) return null;
    return {
      page,
      point: {
        x: Math.max(0, Math.min(PAGE_WIDTH, worldPoint.x - page.x)),
        y: Math.max(0, Math.min(980, worldPoint.y - page.y)),
      },
    };
  }, [clientToWorld, pages]);

  const normalizeBox = (start, end) => ({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.max(8, Math.abs(end.x - start.x)),
    h: Math.max(8, Math.abs(end.y - start.y)),
  });

  const makeElement = (type, start, end, pageId) => {
    const box = normalizeBox(start, end);
    const base = {
      id: crypto.randomUUID(),
      pageId,
      type,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      rotation: 0,
      stroke: '#1f1f1f',
      fill: 'transparent',
      text: '',
    };
    if (type === 'line' || type === 'arrow') {
      return { ...base, x1: start.x, y1: start.y, x2: end.x, y2: end.y, cx: null, cy: null };
    }
    if (type === 'text') {
      return {
        ...base,
        w: Math.max(160, box.w),
        h: Math.max(56, box.h),
        stroke: '#000000',
        fill: '#ffffff',
        strokeAlpha: 1,
        fillAlpha: 0.86,
        text: '',
      };
    }
    return base;
  };

  const focusTextElement = useCallback((id) => {
    setEditingTextId(id);
    const focusWhenReady = (attempt = 0) => {
      const node = textElementRefs.current[id];
      if (!node) {
        if (attempt < 4) window.setTimeout(() => focusWhenReady(attempt + 1), 30);
        return;
      }
      node.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    window.setTimeout(focusWhenReady, 30);
  }, []);

  const updateElement = useCallback((id, patch) => {
    setElements((items) => items.map((element) => (element.id === id ? { ...element, ...patch } : element)));
  }, []);

  const updateSelectedTextElements = useCallback((patch) => {
    if (!selectedTextElements.length) return;
    recordHistory();
    setElements((items) => items.map((element) => (
      selectedTextElements.some((selected) => selected.id === element.id)
        ? { ...element, ...patch }
        : element
    )));
  }, [recordHistory, selectedTextElements]);

  const hasTextSelection = () => {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
  };

  const onCanvasPointerDown = (event) => {
    setContextMenu(null);
    if (event.pointerType === 'touch') {
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointersRef.current.size === 2) {
        const points = Array.from(activePointersRef.current.values());
        pinchRef.current = {
          distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
          zoom: viewport.zoom,
        };
        return;
      }
    }
    if (mode === 'writing') {
      if (!event.target.closest('.page-sheet.active')) exitWriting();
      return;
    }
    if (editingTextId && event.target.closest('.canvas-element.editing')) return;
    if (activeTool !== 'select') {
      const pageHit = getPagePoint(event);
      if (!pageHit) return;
      recordHistory();
      const { page, point } = pageHit;
      setActivePageId(page.id);
      if (activeTool === 'pencil') {
        const id = crypto.randomUUID();
        const element = { id, pageId: page.id, type: 'pencil', points: [point], x: point.x, y: point.y, w: 1, h: 1, rotation: 0, stroke: '#1f1f1f', fill: 'transparent' };
        setElements((items) => [...items, element]);
        setSelectedElementIds([id]);
        dragRef.current = { type: 'pencil', id };
        return;
      }
      const element = makeElement(activeTool, point, point, page.id);
      setElements((items) => [...items, element]);
      setSelectedElementIds([element.id]);
      if (activeTool === 'text') {
        dragRef.current = { type: 'create-text', id: element.id, start: point, pageId: page.id };
      } else {
        dragRef.current = { type: 'create', id: element.id, tool: activeTool, start: point, pageId: page.id };
      }
      return;
    }
    if (event.target.closest('.page-sheet')) {
      if (editingTextId) setEditingTextId(null);
      return;
    }
    if (editingTextId) { setEditingTextId(null); return; }
    setSelectedElementIds([]);
    dragRef.current = { type: 'pan', x: event.clientX, y: event.clientY, viewport };
  };

  const onPagePointerDown = (event, pageId) => {
    if (event.button !== 0 || mode === 'writing' || activeTool !== 'select') return;
    const page = pages.find((item) => item.id === pageId);
    if (!page) return;
    if (event.target.closest('button')) return;
    pointerRef.current = { type: 'page-press', pageId, x: event.clientX, y: event.clientY, startX: page.x, startY: page.y, moved: false };
    setActivePageId(pageId);
    event.stopPropagation();
  };

  const onPointerMove = (event) => {
    if (event.pointerType === 'touch' && activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointersRef.current.size === 2 && pinchRef.current && mode === 'canvas') {
        const points = Array.from(activePointersRef.current.values());
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
        zoomAt(midpoint.x, midpoint.y, pinchRef.current.zoom * (distance / Math.max(1, pinchRef.current.distance)));
        return;
      }
    }
    const pending = pointerRef.current;
    if (pending?.type === 'page-press') {
      const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (distance > 4) {
        pending.moved = true;
        recordHistory();
        dragRef.current = { type: 'page', pageId: pending.pageId, x: pending.x, y: pending.y, startX: pending.startX, startY: pending.startY };
      }
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === 'create') {
      const pageHit = getPagePoint(event, drag.pageId);
      if (!pageHit) return;
      setElements((items) => items.map((element) => (element.id === drag.id ? { ...makeElement(drag.tool, drag.start, pageHit.point, drag.pageId), id: drag.id } : element)));
      return;
    }
    if (drag.type === 'create-text') {
      const pageHit = getPagePoint(event, drag.pageId);
      if (!pageHit) return;
      const box = normalizeBox(drag.start, pageHit.point);
      setElements((items) => items.map((element) => (
        element.id === drag.id
          ? { ...element, x: box.x, y: box.y, w: Math.max(160, box.w), h: Math.max(56, box.h) }
          : element
      )));
      return;
    }
    if (drag.type === 'pencil') {
      playPencil();
      const pageHit = getPagePoint(event, elements.find((item) => item.id === drag.id)?.pageId);
      if (!pageHit) return;
      const point = pageHit.point;
      setElements((items) => items.map((element) => {
        if (element.id !== drag.id) return element;
        const points = [...element.points, point];
        const xs = points.map((item) => item.x);
        const ys = points.map((item) => item.y);
        return {
          ...element,
          points,
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        };
      }));
      return;
    }
    if (drag.type === 'curve-arrow') {
      const pageHit = getPagePoint(event, elements.find((item) => item.id === drag.id)?.pageId);
      if (!pageHit) return;
      setElements((items) => items.map((element) => {
        if (element.id !== drag.id) return element;
        return { ...element, cx: pageHit.point.x, cy: pageHit.point.y };
      }));
      return;
    }
    if (drag.type === 'element') {
      const dx = (event.clientX - drag.x) / viewport.zoom;
      const dy = (event.clientY - drag.y) / viewport.zoom;
      setElements((items) => items.map((element) => {
        if (!drag.ids.includes(element.id)) return element;
        const nextX = Math.max(0, Math.min(PAGE_WIDTH - Math.max(1, element.w || 1), element.x + dx));
        const nextY = Math.max(0, Math.min(980 - Math.max(1, element.h || 1), element.y + dy));
        const actualDx = nextX - element.x;
        const actualDy = nextY - element.y;
        return {
          ...element,
          x: nextX,
          y: nextY,
          x1: element.x1 == null ? element.x1 : element.x1 + actualDx,
          y1: element.y1 == null ? element.y1 : element.y1 + actualDy,
          x2: element.x2 == null ? element.x2 : element.x2 + actualDx,
          y2: element.y2 == null ? element.y2 : element.y2 + actualDy,
          cx: element.cx == null ? element.cx : element.cx + actualDx,
          cy: element.cy == null ? element.cy : element.cy + actualDy,
          points: element.points?.map((point) => ({ x: point.x + actualDx, y: point.y + actualDy })),
        };
      }));
      dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
      return;
    }
    if (drag.type === 'resize') {
      const pageHit = getPagePoint(event, elements.find((item) => item.id === drag.id)?.pageId);
      if (!pageHit) return;
      const point = pageHit.point;
      setElements((items) => items.map((element) => {
        if (element.id !== drag.id) return element;
        const next = { ...element };
        const minW = element.type === 'text' ? 120 : 24;
        const minH = element.type === 'text' ? 44 : 24;
        next.w = Math.max(minW, Math.min(PAGE_WIDTH - element.x, point.x - element.x));
        next.h = Math.max(minH, Math.min(PAGE_HEIGHT - element.y, point.y - element.y));
        return next;
      }));
      return;
    }
    if (drag.type === 'rotate') {
      const pageHit = getPagePoint(event, elements.find((item) => item.id === drag.id)?.pageId);
      if (!pageHit) return;
      const point = pageHit.point;
      setElements((items) => items.map((element) => {
        if (element.id !== drag.id) return element;
        const cx = element.x + element.w / 2;
        const cy = element.y + element.h / 2;
        const rotation = Math.atan2(point.y - cy, point.x - cx) * 180 / Math.PI + 90;
        return { ...element, rotation };
      }));
      return;
    }
    if (drag.type === 'pan') {
      setViewport({
        ...drag.viewport,
        x: drag.viewport.x + event.clientX - drag.x,
        y: drag.viewport.y + event.clientY - drag.y,
      });
      return;
    }
    if (drag.type === 'page') {
      const dx = (event.clientX - drag.x) / viewport.zoom;
      const dy = (event.clientY - drag.y) / viewport.zoom;
      setPages((items) => items.map((page) => (page.id === drag.pageId ? { ...page, x: drag.startX + dx, y: drag.startY + dy } : page)));
    }
  };

  const onPointerUp = () => {
    activePointersRef.current.clear();
    pinchRef.current = null;
    const drag = dragRef.current;
    const pending = pointerRef.current;
    if (pending?.type === 'page-press' && !pending.moved) {
      focusPage(pending.pageId);
    }
    if (drag?.type === 'create-text') {
      setSelectedElementIds([drag.id]);
      focusTextElement(drag.id);
    }
    pointerRef.current = null;
    dragRef.current = null;
  };

  const zoomAt = useCallback((clientX, clientY, nextZoom) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setViewport((current) => {
      const zoom = Math.min(2.4, Math.max(0.24, nextZoom));
      const cursorX = clientX - rect.left;
      const cursorY = clientY - rect.top;
      const worldX = (cursorX - current.x) / current.zoom;
      const worldY = (cursorY - current.y) / current.zoom;
      return {
        zoom,
        x: cursorX - worldX * zoom,
        y: cursorY - worldY * zoom,
      };
    });
  }, []);

  const zoomBy = useCallback((factor) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, viewport.zoom * factor);
  }, [viewport.zoom, zoomAt]);

  const wheelHandlerRef = useRef(null);
  wheelHandlerRef.current = (event) => {
    if (modeRef.current === 'writing') return;
    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 30;
    else if (event.deltaMode === 2) delta *= 600;
    zoomAt(event.clientX, event.clientY, viewport.zoom * Math.exp(-delta * 0.0012));
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handler = (event) => wheelHandlerRef.current(event);
    stage.addEventListener('wheel', handler, { passive: false });
    return () => stage.removeEventListener('wheel', handler);
  }, []);

  const exportPdf = async () => {
    if (exporting) return;
    setExportError(null);
    setExporting(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const A4_W = 210;
      const A4_H = 297;
      const MARGIN = 10;
      const MAX_W = A4_W - MARGIN * 2;
      const MAX_H = A4_H - MARGIN * 2;
      let hasPdfPage = false;

      const shell = document.querySelector('.app-shell');
      const shellStyle = shell ? getComputedStyle(shell) : null;
      const cssVars = ['--bg', '--paper', '--ink', '--accent', '--accent-soft', '--line', '--line-strong', '--muted', '--shadow', '--paper-shadow', '--button-shadow', '--surface', '--surface-strong'];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const src = document.querySelector(`.page-sheet[data-page-id="${page.id}"]`);
        if (!src) continue;

        const clone = src.cloneNode(true);
        clone.style.cssText = '';
        clone.style.position = 'relative';
        clone.style.left = '0';
        clone.style.top = '0';
        clone.style.transform = 'none';
        clone.style.width = PAGE_WIDTH + 'px';
        clone.style.minHeight = '980px';
        clone.style.margin = '0';
        clone.style.border = '0';
        clone.style.borderRadius = '0';
        clone.style.boxShadow = 'none';

        if (shellStyle) {
          cssVars.forEach((v) => {
            const val = shellStyle.getPropertyValue(v);
            if (val) clone.style.setProperty(v, val);
          });
        }

        const editor = clone.querySelector('.document-editor');
        if (editor) {
          editor.removeAttribute('contenteditable');
          editor.style.pointerEvents = 'none';
          editor.style.cursor = 'default';
          editor.style.minHeight = '980px';
        }

        const layer = clone.querySelector('.page-canvas-layer');
        if (layer) layer.style.pointerEvents = 'none';

        const shapes = clone.querySelectorAll('.canvas-element');
        shapes.forEach((s) => {
          s.style.pointerEvents = 'none';
          s.classList.remove('selected', 'editing');
          const handles = s.querySelectorAll('.rotate-handle, .resize-handle, .midpoint-handle');
          handles.forEach((h) => h.remove());
        });

        const host = document.createElement('div');
        host.style.cssText = `position:fixed;left:-9999px;top:0;z-index:-1;width:${PAGE_WIDTH}px`;
        host.appendChild(clone);
        document.body.appendChild(host);

        // html2canvas v1.4.1 can't parse color-mix() or color() CSS functions.
        // Modern browsers may resolve color-mix() to color(srgb ...) in computed styles.
        // Use offscreen canvas to convert any CSS color to standard rgb()/rgba().
        const colorCtx = document.createElement('canvas').getContext('2d');
        const toRgba = (v) => { colorCtx.fillStyle = v; colorCtx.fillRect(0, 0, 1, 1); const d = colorCtx.getImageData(0, 0, 1, 1).data; return d[3] < 255 ? `rgba(${d[0]},${d[1]},${d[2]},${(d[3]/255).toFixed(3)})` : `rgb(${d[0]},${d[1]},${d[2]})`; };
        const isDefaultBg = (v) => !v || ['none','transparent','rgba(0, 0, 0, 0)','rgba(0,0,0,0)'].includes(v.trim());
        // Hide ::before pseudo-element (contains color-mix() inside a gradient)
        clone.appendChild(Object.assign(document.createElement('style'), { textContent: '.page-sheet::before { display: none !important; }' }));
        clone.querySelectorAll('*').forEach(el => {
          const cs = getComputedStyle(el);
          const bg = cs.backgroundColor;
          if (!isDefaultBg(bg) && bg.includes('color(')) el.style.backgroundColor = toRgba(bg);
          const bs = cs.boxShadow;
          if (bs && bs !== 'none') el.style.boxShadow = bs;
          const bc = cs.borderColor;
          if (!isDefaultBg(bc)) el.style.borderColor = bc.includes('color(') ? toRgba(bc) : bc;
        });

        try {
          const canvas = await html2canvas(host, {
            scale: 2,
            backgroundColor: null,
            useCORS: true,
            logging: false,
          });

          const imgH = (canvas.height / canvas.width) * MAX_W;
          const image = canvas.toDataURL('image/png');
          const segmentCount = Math.max(1, Math.ceil(imgH / MAX_H));

          for (let segment = 0; segment < segmentCount; segment++) {
            if (hasPdfPage) pdf.addPage();
            hasPdfPage = true;
            pdf.addImage(image, 'PNG', MARGIN, MARGIN - segment * MAX_H, MAX_W, imgH);
          }
        } finally {
          host.remove();
        }
      }

      pdf.save('stateflow-export.pdf');
    } catch (e) {
      console.error('PDF export error:', e);
      setExportError(e?.message || String(e));
    } finally {
      setExporting(false);
    }
  };

  const onElementPointerDown = (event, elementId) => {
    if (activeTool !== 'select') return;
    event.stopPropagation();
    if (editingTextId) {
      if (elementId === editingTextId && event.target.closest?.('[contenteditable="true"]')) return;
      setEditingTextId(null);
    }
    const el = elements.find((e) => e.id === elementId);
    if (el && (el.type === 'arrow' || el.type === 'line')) {
      const pageHit = getPagePoint(event, el.pageId);
      if (pageHit) {
        const midX = (el.x1 + el.x2) / 2;
        const midY = (el.y1 + el.y2) / 2;
        if (Math.hypot(pageHit.point.x - midX, pageHit.point.y - midY) < 18 / viewport.zoom) {
          setSelectedElementIds([elementId]);
          recordHistory();
          dragRef.current = { type: 'curve-arrow', id: elementId };
          return;
        }
      }
    }
    const ids = event.shiftKey
      ? Array.from(new Set([...selectedElementIds, elementId]))
      : selectedElementIds.includes(elementId) ? selectedElementIds : [elementId];
    setSelectedElementIds(ids);
    recordHistory();
    dragRef.current = { type: 'element', ids, x: event.clientX, y: event.clientY };
  };

  const addImage = useCallback((src, pageId, point) => {
    recordHistory();
    const id = crypto.randomUUID();
    setElements((items) => [...items, {
      id,
      pageId,
      type: 'image',
      src,
      x: point.x,
      y: point.y,
      w: 320,
      h: 220,
      rotation: 0,
      stroke: '#000000',
      fill: 'transparent',
    }]);
    setSelectedElementIds([id]);
  }, [recordHistory]);

  const readImageFile = useCallback((file, pageId, point) => {
    if (!file?.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result, pageId, point);
    reader.readAsDataURL(file);
  }, [addImage]);

  const onDrop = (event) => {
    event.preventDefault();
    const pageHit = getPagePoint(event);
    if (!pageHit) return;
    Array.from(event.dataTransfer.files).forEach((file) => readImageFile(file, pageHit.page.id, pageHit.point));
  };

  const onAppContextMenu = (event) => {
    const pageNode = event.target.closest?.('.page-sheet');
    playRightClick();
    if (mode === 'canvas') event.preventDefault();
    if (!pageNode || mode !== 'canvas' || hasTextSelection()) {
      setContextMenu(null);
      return;
    }
    const pageId = pageNode.dataset.pageId;
    setActivePageId(pageId);
    setContextMenu({ pageId, x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    document.addEventListener('selectionchange', saveSelection);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') exitWriting();
      const isEditingText = event.target?.closest?.('[contenteditable="true"]');
      if (isEditingText) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && mode === 'canvas' && selectedElementIds.length) {
        event.preventDefault();
        recordHistory();
        setElements((items) => items.filter((element) => !selectedElementIds.includes(element.id)));
        setSelectedElementIds([]);
      }
    };
    const onPaste = (event) => {
      if (event.defaultPrevented) return;
      if (mode === 'writing' && event.target?.closest?.('[contenteditable]')) return;
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
      if (!item) return;
      event.preventDefault();
      const stage = stageRef.current;
      const rect = stage.getBoundingClientRect();
      const page = activePage;
      readImageFile(item.getAsFile(), page.id, {
        x: Math.max(0, Math.min(PAGE_WIDTH - 320, Math.round((rect.width / 2 - viewport.x) / viewport.zoom - page.x))),
        y: Math.max(0, Math.min(PAGE_HEIGHT - 220, Math.round((rect.height / 2 - viewport.y) / viewport.zoom - page.y))),
      });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('selectionchange', saveSelection);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [activePage, exitWriting, mode, readImageFile, recordHistory, redo, saveSelection, selectedElementIds, undo, viewport]);

  return (
    <main
      className={`app-shell ${mode === 'writing' ? 'writing-mode' : 'canvas-mode'}`}
      data-theme={theme}
      data-tool={activeTool}
      data-font={documentFont}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseDown={(event) => {
        if (event.button === 0) playLeftClick();
      }}
      onContextMenu={onAppContextMenu}
    >
      <aside className="sidebar" aria-label="Controles del documento">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>Stateflow</strong>
            <span>{mode === 'writing' ? 'Writing focus' : 'Infinite canvas'}</span>
          </div>
        </div>
        <div className={`save-status ${saveState.status}`} title={saveState.error || saveStatusText}>
          <span />
          {saveStatusText}
        </div>

        <section className="sidebar-section">
          <div className="section-row">
            <span className="section-label">Tema</span>
            <button className="ios-switch" type="button" aria-label="Cambiar tema" aria-pressed={theme === 'dark'} onClick={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}>
              <span />
            </button>
          </div>
          <button className={soundsEnabled ? 'wide-toggle active' : 'wide-toggle'} type="button" onClick={() => setSoundsEnabled((value) => !value)}>
            Sonidos {soundsEnabled ? 'on' : 'off'}
          </button>
          <label className="range-label" htmlFor="keyboard-volume">
            Volumen teclado
            <span>{Math.round(keyboardVolume * 100)}%</span>
          </label>
          <input id="keyboard-volume" type="range" min="0" max="0.12" step="0.005" value={keyboardVolume} onChange={(event) => setKeyboardVolume(Number(event.target.value))} />
        </section>

        <section className="sidebar-section">
          <span className="section-label">Zoom</span>
          <div className="zoom-controls">
            <button type="button" onClick={() => zoomBy(0.85)}>-</button>
            <span>{Math.round(viewport.zoom * 100)}%</span>
            <button type="button" onClick={() => zoomBy(1.18)}>+</button>
          </div>
          <p className="helper-text">Rueda del mouse o pinch del trackpad para hacer zoom. Arrastra el fondo del canvas para desplazarte.</p>
        </section>

        <section className="sidebar-section">
          <span className="section-label">Herramientas</span>
          <div className="tool-grid">
            {shapeTools.map((id) => (
              <button key={id} type="button" className={activeTool === id ? 'active' : ''} onClick={() => { setActiveTool(id); setEditingTextId(null); if (id !== 'select') setMode('canvas'); }}>
                <ToolIcon tool={id} />
              </button>
            ))}
          </div>
          <button
            className="wide-toggle"
            type="button"
            disabled={!selectedElementIds.length}
            onClick={() => {
              recordHistory();
              setElements((items) => items.filter((element) => !selectedElementIds.includes(element.id)));
              setSelectedElementIds([]);
            }}
          >
            Eliminar seleccion
          </button>
          <div className="split-actions">
            <button type="button" onClick={undo}>Deshacer</button>
            <button type="button" onClick={redo}>Rehacer</button>
          </div>
        </section>

        <section className="sidebar-section">
          <span className="section-label">Hojas</span>
          <button className="primary-control" type="button" onClick={createPage}>Crear hoja</button>
          <div className="page-list">
            {pages.map((page) => (
              <button key={page.id} className={page.id === activePageId ? 'page-list-item active' : 'page-list-item'} type="button" onClick={() => focusPage(page.id)}>
                <span>{page.title}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section">
          <span className="section-label">Texto</span>
          <div className="font-switch" role="group" aria-label="Tipografia del documento">
            <button type="button" className={documentFont === 'excalifont' ? 'active' : ''} onClick={() => setDocumentFont('excalifont')}>
              Excalifont
            </button>
            <button type="button" className={documentFont === 'original' ? 'active' : ''} onClick={() => setDocumentFont('original')}>
              Original
            </button>
          </div>
          <div className="format-grid">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bold')} style={{ fontWeight: 700 }}>B</button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('italic')} style={{ fontStyle: 'italic' }}>I</button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('underline')} style={{ textDecoration: 'underline' }}>U</button>
          </div>
          <div className="font-switch" style={{ marginTop: 6 }} role="group" aria-label="Tipografia para la seleccion">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFont('"Excalifont", "Virgil", "Comic Sans MS", "Segoe Print", "Bradley Hand ITC", cursive')} style={{ fontFamily: 'Excalifont, "Virgil", "Comic Sans MS", "Segoe Print", "Bradley Hand ITC", cursive', fontSize: 12 }}>
              E
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFont('"Comic Sans MS", "Segoe Print", "Bradley Hand ITC", cursive')} style={{ fontFamily: '"Comic Sans MS", "Segoe Print", "Bradley Hand ITC", cursive', fontSize: 12 }}>
              O
            </button>
          </div>
        </section>

        <section className="sidebar-section">
          <label className="section-label" htmlFor="font-size">Tamano</label>
          <input id="font-size" type="range" min="16" max="48" value={fontSize} onMouseDown={(event) => event.preventDefault()} onChange={(event) => applyFontSize(Number(event.target.value))} />
          <input type="number" min="8" max="200" value={fontSize} onMouseDown={(event) => event.preventDefault()} onChange={(event) => { const v = Math.min(200, Math.max(8, Number(event.target.value) || 16)); applyFontSize(v); }} style={{ width: '100%', marginTop: 4, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface-strong)', color: 'var(--ink)', font: 'inherit', fontSize: 13, textAlign: 'center' }} />
          <div className="size-preset-row">
            {fontSizes.map((size) => (
              <button key={size} className={fontSize === size ? 'active' : ''} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyFontSize(size)}>
                {size}
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section">
          <label className="section-label" htmlFor="line-height">Interlineado</label>
          <input id="line-height" type="range" min="1" max="3" step="0.05" value={lineHeight} onMouseDown={(event) => event.preventDefault()} onChange={(event) => setLineHeight(Number(event.target.value))} />
          <input type="number" min="0.8" max="4" step="0.05" value={lineHeight} onMouseDown={(event) => event.preventDefault()} onChange={(event) => setLineHeight(Math.min(4, Math.max(0.8, Number(event.target.value) || 1.68)))} style={{ width: '100%', padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface-strong)', color: 'var(--ink)', font: 'inherit', fontSize: 13, textAlign: 'center' }} />
        </section>

        <section className="sidebar-section">
          <span className="section-label">Color</span>
          <div className="color-row">
            {colors.map((color) => (
              <button key={color} className={textColor === color ? 'color-dot active' : 'color-dot'} type="button" style={{ '--swatch': color }} aria-label={`Color ${color}`} onMouseDown={(event) => event.preventDefault()} onClick={() => applyColor(color)} />
            ))}
          </div>
        </section>

        {primaryTextElement && (
          <section className="sidebar-section">
            <span className="section-label">Cuadro de texto</span>
            <div className="inspector-group">
              <span>Borde</span>
              <div className="color-row">
                {colors.map((color) => (
                  <button
                    key={`border-${color}`}
                    className={primaryTextElement.stroke === color ? 'color-dot active' : 'color-dot'}
                    type="button"
                    style={{ '--swatch': color }}
                    aria-label={`Borde ${color}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => updateSelectedTextElements({ stroke: color, strokeAlpha: primaryTextElement.strokeAlpha ?? 1 })}
                  />
                ))}
              </div>
              <button className="wide-toggle subtle" type="button" onClick={() => updateSelectedTextElements({ strokeAlpha: 0 })}>Borde transparente</button>
              <label className="range-label" htmlFor="text-border-alpha">
                Opacidad borde
                <span>{Math.round((primaryTextElement.strokeAlpha ?? 1) * 100)}%</span>
              </label>
              <input id="text-border-alpha" type="range" min="0" max="1" step="0.05" value={primaryTextElement.strokeAlpha ?? 1} onMouseDown={(event) => event.preventDefault()} onChange={(event) => updateSelectedTextElements({ strokeAlpha: Number(event.target.value) })} />
            </div>
            <div className="inspector-group">
              <span>Fondo</span>
              <div className="color-row">
                {fillColors.map((color) => (
                  <button
                    key={`fill-${color}`}
                    className={primaryTextElement.fill === color ? 'color-dot active' : 'color-dot'}
                    type="button"
                    style={{ '--swatch': color }}
                    aria-label={`Fondo ${color}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => updateSelectedTextElements({ fill: color, fillAlpha: primaryTextElement.fillAlpha ?? 0.86 })}
                  />
                ))}
              </div>
              <button className="wide-toggle subtle" type="button" onClick={() => updateSelectedTextElements({ fillAlpha: 0 })}>Fondo transparente</button>
              <label className="range-label" htmlFor="text-fill-alpha">
                Opacidad fondo
                <span>{Math.round((primaryTextElement.fillAlpha ?? 0.86) * 100)}%</span>
              </label>
              <input id="text-fill-alpha" type="range" min="0" max="1" step="0.05" value={primaryTextElement.fillAlpha ?? 0.86} onMouseDown={(event) => event.preventDefault()} onChange={(event) => updateSelectedTextElements({ fillAlpha: Number(event.target.value) })} />
            </div>
          </section>
        )}

        <section className="sidebar-section">
          <span className="section-label">Exportar</span>
          <button className="primary-control" type="button" onClick={exportPdf} disabled={exporting}>{exporting ? 'Exportando...' : 'Exportar PDF'}</button>
          {exportError && <p style={{ color: '#e03131', fontSize: 11, margin: '4px 0 0' }}>Error: {exportError}</p>}
          <p className="helper-text">Exporta todas las hojas como PDF tamaño A4, cada hoja en una pagina separada.</p>
        </section>
      </aside>

      <section ref={stageRef} className="canvas-stage" aria-label="Canvas infinito" onPointerDown={onCanvasPointerDown} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        {contextMenu && (
          <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => { duplicatePage(contextMenu.pageId); setContextMenu(null); }}>Duplicar hoja</button>
            <button type="button" onClick={() => { deletePage(contextMenu.pageId); setContextMenu(null); }}>Eliminar hoja</button>
          </div>
        )}
        <div className="world" style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})` }}>
          {pages.map((page) => (
            <article
              key={page.id}
              data-page-id={page.id}
              className={`page-sheet ${page.id === activePageId ? 'active' : ''} ${page.id === printingPageId ? 'print-target' : ''}`}
              style={{ transform: `translate3d(${page.x}px, ${page.y}px, 0)` }}
              onPointerDown={(event) => onPagePointerDown(event, page.id)}
            >
              <div
                ref={(node) => {
                  if (!node) return;
                  editorRefs.current[page.id] = node;
                  const renderKey = `${page.id}:${editorRenderVersion}`;
                  if (node.dataset.renderKey !== renderKey) {
                    node.innerHTML = pageHtmlRef.current[page.id] ?? page.html ?? '';
                    node.dataset.renderKey = renderKey;
                  }
                }}
                className="document-editor"
                contentEditable={mode === 'writing' && page.id === activePageId}
                style={{ lineHeight }}
                suppressContentEditableWarning
                spellCheck="true"
                onInput={(event) => updatePageHtml(page.id, event.currentTarget.innerHTML)}
                onBlur={() => {
                  saveSelection();
                  commitPageHtml(page.id);
                  textEditSessionRef.current = null;
                }}
                onPaste={(event) => {
                  const imgItem = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
                  if (imgItem) {
                    event.preventDefault();
                    const stage = stageRef.current;
                    if (stage) {
                      const rect = stage.getBoundingClientRect();
                      readImageFile(imgItem.getAsFile(), page.id, {
                        x: Math.max(0, Math.min(PAGE_WIDTH - 320, Math.round((rect.width / 2 - viewport.x) / viewport.zoom - page.x))),
                        y: Math.max(0, Math.min(PAGE_HEIGHT - 220, Math.round((rect.height / 2 - viewport.y) / viewport.zoom - page.y))),
                      });
                    }
                    return;
                  }
                  pasteCleanHtml(event, page.id);
                }}
                onMouseUp={saveSelection}
                onKeyDown={(event) => {
                  if (event.key.length === 1 || ['Backspace', 'Enter', 'Delete', ' '].includes(event.key)) playType();
                }}
                onKeyUp={saveSelection}
              />
              <div className="page-canvas-layer">
                {elements.filter((element) => element.pageId === page.id).map((element) => (
                  <CanvasElement
                    key={element.id}
                    element={element}
                    selected={selectedElementIds.includes(element.id)}
                    editing={editingTextId === element.id}
                    onPointerDown={(event) => onElementPointerDown(event, element.id)}
                    onResizeStart={(event) => {
                      event.stopPropagation();
                      setSelectedElementIds([element.id]);
                      recordHistory();
                      dragRef.current = { type: 'resize', id: element.id };
                    }}
                    onRotateStart={(event) => {
                      event.stopPropagation();
                      setSelectedElementIds([element.id]);
                      recordHistory();
                      dragRef.current = { type: 'rotate', id: element.id };
                    }}
                    onDoubleClick={() => {
                      if (element.type === 'text') {
                        focusTextElement(element.id);
                      }
                    }}
                    onTextInput={(html) => updateElement(element.id, { text: html })}
                    onTextResize={(w, h) => updateElement(element.id, { w, h })}
                    textRef={(node) => {
                      if (node) textElementRefs.current[element.id] = node;
                    }}
                    playType={playType}
                  />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function CanvasElement({ element, selected, editing, onPointerDown, onResizeStart, onRotateStart, onDoubleClick, onTextInput, onTextResize, textRef, playType }) {
  const style = {
    transform: `translate3d(${element.x}px, ${element.y}px, 0) rotate(${element.rotation || 0}deg)`,
    width: `${Math.max(1, element.w || 1)}px`,
    height: `${Math.max(1, element.h || 1)}px`,
  };

  const isArrowOrLine = element.type === 'arrow' || element.type === 'line';
  let midX, midY;
  if (isArrowOrLine) {
    if (element.cx != null && element.cy != null) {
      midX = element.cx - element.x;
      midY = element.cy - element.y;
    } else {
      midX = ((element.x1 ?? 0) + (element.x2 ?? element.w)) / 2 - element.x;
      midY = ((element.y1 ?? 0) + (element.y2 ?? element.h)) / 2 - element.y;
    }
  }

  return (
    <div className={`canvas-element ${selected ? 'selected' : ''} ${editing ? 'editing' : ''}`} data-type={element.type} style={style} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
      {renderElementContent(element, editing, textRef, onTextInput, playType, onTextResize)}
      {selected && !editing && (
        <>
          {isArrowOrLine && <div className="midpoint-handle" style={{ left: midX, top: midY }} />}
          <button className="rotate-handle" type="button" onPointerDown={onRotateStart} aria-label="Rotar" />
          <button className="resize-handle" type="button" onPointerDown={onResizeStart} aria-label="Redimensionar" />
        </>
      )}
    </div>
  );
}

function renderElementContent(element, editing, textRef, onTextInput, playType, onTextResize) {
  if (element.type === 'image') {
    return <img className="canvas-image" src={element.src} alt="" draggable="false" />;
  }
  if (element.type === 'text') {
    const borderColor = colorWithAlpha(element.stroke || '#000000', element.strokeAlpha ?? 1);
    const backgroundColor = colorWithAlpha(element.fill || '#ffffff', element.fillAlpha ?? 0.86);
    return (
      <div
        ref={(node) => {
          if (!node) return;
          textRef(node);
          if (!editing && node.innerHTML !== (element.text || '')) node.innerHTML = element.text || '';
          if (!node.dataset.textElementId) {
            node.innerHTML = element.text || '';
            node.dataset.textElementId = element.id;
          }
        }}
        className="canvas-textbox"
        style={{ borderColor, backgroundColor }}
        contentEditable={editing}
        suppressContentEditableWarning
        onInput={(event) => {
          onTextInput(event.currentTarget.innerHTML);
        }}
        onPaste={(event) => {
          event.preventDefault();
          const html = event.clipboardData?.getData('text/html');
          const text = event.clipboardData?.getData('text/plain') || '';
          const fallback = document.createElement('div');
          fallback.textContent = text;
          const safeHtml = sanitizeHtml(html || fallback.innerHTML.replace(/\r?\n/g, '<br>'));
          if (!safeHtml) return;
          document.execCommand('insertHTML', false, safeHtml);
          onTextInput(event.currentTarget.innerHTML);
        }}
        onKeyDown={(event) => {
          if (event.key.length === 1 || ['Backspace', 'Enter', 'Delete', ' '].includes(event.key)) playType();
        }}
      />
    );
  }
  if (element.type === 'pencil') {
    const d = (element.points || []).map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x - element.x} ${point.y - element.y}`).join(' ');
    return <svg className="shape-svg"><path d={d} fill="none" stroke={element.stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  return <svg className="shape-svg">{shapeNode(element)}</svg>;
}

function shapeNode(element) {
  const w = Math.max(1, element.w || 1);
  const h = Math.max(1, element.h || 1);
  const stroke = element.stroke;
  const fill = element.fill;
  switch (element.type) {
    case 'circle':
      return <ellipse cx={w / 2} cy={h / 2} rx={Math.min(w, h) / 2} ry={Math.min(w, h) / 2} fill={fill} stroke={stroke} strokeWidth="2.4" />;
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth="2.4" />;
    case 'line':
      return <line x1="0" y1="0" x2={w} y2={h} stroke={stroke} strokeWidth="2.6" strokeLinecap="round" />;
    case 'arrow':
      return (
        <>
          <defs><marker id={`arrow-${element.id}`} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill={stroke} /></marker></defs>
          {element.cx != null && element.cy != null
            ? <path d={`M ${element.x1 - element.x} ${element.y1 - element.y} Q ${element.cx - element.x} ${element.cy - element.y} ${element.x2 - element.x} ${element.y2 - element.y}`} fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" markerEnd={`url(#arrow-${element.id})`} />
            : <line x1="0" y1="0" x2={w} y2={h} stroke={stroke} strokeWidth="2.6" strokeLinecap="round" markerEnd={`url(#arrow-${element.id})`} />}
        </>
      );
    case 'triangle':
      return <polygon points={`${w / 2},0 ${w},${h} 0,${h}`} fill={fill} stroke={stroke} strokeWidth="2.4" />;
    case 'diamond':
      return <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} fill={fill} stroke={stroke} strokeWidth="2.4" />;
    case 'polygon':
      return <polygon points={`${w * 0.25},0 ${w * 0.75},0 ${w},${h / 2} ${w * 0.75},${h} ${w * 0.25},${h} 0,${h / 2}`} fill={fill} stroke={stroke} strokeWidth="2.4" />;
    default:
      return <rect x="0" y="0" width={w} height={h} rx="10" fill={fill} stroke={stroke} strokeWidth="2.4" />;
  }
}

function ToolIcon({ tool }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (tool) {
    case 'select':
      return <svg {...p}><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="M13 13l6 6" /></svg>;
    case 'rect':
      return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /></svg>;
    case 'circle':
      return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>;
    case 'ellipse':
      return <svg {...p}><ellipse cx="12" cy="12" rx="10" ry="6" /></svg>;
    case 'line':
      return <svg {...p}><line x1="4" y1="20" x2="20" y2="4" /></svg>;
    case 'arrow':
      return <svg {...p}><line x1="5" y1="19" x2="19" y2="5" /><polyline points="13 5 19 5 19 11" /></svg>;
    case 'triangle':
      return <svg {...p}><polygon points="12 3 3 21 21 21" /></svg>;
    case 'diamond':
      return <svg {...p}><polygon points="12 3 21 12 12 21 3 12" /></svg>;
    case 'polygon':
      return <svg {...p}><polygon points="12 2 22 7 22 17 12 22 2 17 2 7" /></svg>;
    case 'pencil':
      return <svg {...p}><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>;
    case 'text':
      return <svg {...p}><polyline points="4 7 4 4 20 4 20 7" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="8" y1="20" x2="16" y2="20" /></svg>;
    default:
      return null;
  }
}

export default App;
