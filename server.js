/**
 * Orta Widget Hub (Mock & Ingestion Service)
 * 
 * Легковесный сервис виджетов для платформы Orta Mobile:
 * - GET  /api/v1/widgets               — список виджетов для главного экрана
 * - POST /api/v1/widgets/publish       — публикация/обновление виджета сторонним сервисом
 * - DELETE /api/v1/widgets/:id         — удаление виджета по id или externalId
 * - POST /api/v1/widgets/reset         — сброс к демонстрационным данным
 * - GET  /health                       — проверка работоспособности
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4005;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'widgets.json');

// Демонстрационный набор виджетов (инициализируется при первом запуске)
const INITIAL_WIDGETS = [
  {
    id: 'widget-sed-docs',
    externalId: 'sed-pending-counter',
    appId: 'b9b11ba3-ec4d-4c45-9cd0-9146b084809b',
    appName: 'СЭД: Документы',
    template: 'metric',
    title: 'Документы на подпись',
    subtitle: 'Срочный договор поставки №42',
    counter: 3,
    badgeText: 'Требует внимания',
    badgeVariant: 'warning',
    actionText: 'Согласовать →',
    actionUrl: '/documents/pending',
    priority: 90,
  },
  {
    id: 'widget-calendar-sync',
    externalId: 'meeting-sync-orta',
    appId: 'b9b11ba3-ec4d-4c45-9cd0-9146b084809b',
    appName: 'Календарь',
    template: 'event',
    title: 'Синхрон команды Orta',
    subtitle: 'Переговорная 3 • Через 40 минут',
    badgeText: '14:00',
    badgeVariant: 'accent',
    actionText: 'Войти в звонок →',
    actionUrl: '/meetings/sync-orta',
    priority: 80,
  },
  {
    id: 'widget-approval-vacation',
    externalId: 'vacation-req-102',
    appId: 'b9b11ba3-ec4d-4c45-9cd0-9146b084809b',
    appName: 'HR Портал',
    template: 'approval',
    title: 'Заявление на отпуск',
    subtitle: 'Аскар Каримов • 14 дней с 1 ноября',
    badgeText: 'Согласование',
    badgeVariant: 'warning',
    actionText: 'Открыть заявку →',
    actionUrl: '/requests/vacation/102',
    priority: 75,
  },
  {
    id: 'widget-poll-q4',
    externalId: 'poll-education-q4',
    appId: 'b9b11ba3-ec4d-4c45-9cd0-9146b084809b',
    appName: 'Опросы компании',
    template: 'poll',
    title: 'Корпоративное обучение Q4',
    badgeText: 'Голосование',
    badgeVariant: 'neutral',
    actionText: 'Принять участие →',
    actionUrl: '/polls/corp-q4',
    options: [
      { id: 'opt_1', text: 'AI и автоматизация', percentage: 68, isLeading: true },
      { id: 'opt_2', text: 'Управление проектами', percentage: 32, isLeading: false },
    ],
    priority: 60,
  },
  {
    id: 'widget-pass-guest',
    externalId: 'pass-guest-994',
    appId: 'b9b11ba3-ec4d-4c45-9cd0-9146b084809b',
    appName: 'Бюро пропусков',
    template: 'progress',
    title: 'Гостевой пропуск',
    subtitle: 'Проверка службы безопасности (Шаг 2 из 3)',
    progress: 66,
    badgeText: 'В обработке',
    badgeVariant: 'accent',
    actionText: 'Детали пропуска →',
    actionUrl: '/passes/guest-994',
    priority: 50,
  },
];

/**
 * Файловое хранилище (Persistence)
 */
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_WIDGETS, null, 2), 'utf-8');
  }
}

function loadWidgets() {
  try {
    ensureDataFile();
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [...INITIAL_WIDGETS];
  } catch (err) {
    console.error('[Storage] Error loading widgets from file, using initial:', err.message);
    return [...INITIAL_WIDGETS];
  }
}

function saveWidgets(widgets) {
  try {
    ensureDataFile();
    fs.writeFileSync(DATA_FILE, JSON.stringify(widgets, null, 2), 'utf-8');
    console.log(`[Storage] Saved ${widgets.length} widgets to ${DATA_FILE}`);
  } catch (err) {
    console.error('[Storage] Error saving widgets to file:', err.message);
  }
}

// Загрузка сохраненных виджетов с диска
let widgetsStore = loadWidgets();

/**
 * Утилита для отправки JSON ответа с CORS
 */
function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  });
  res.end(payload);
}

/**
 * Чтение JSON body из входящего запроса
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Обработка Preflight CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    });
    return res.end();
  }

  // 1. Healthcheck
  if (pathname === '/health' && method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'orta-widget-service',
      time: new Date().toISOString(),
      activeWidgetsCount: widgetsStore.length,
      storageFile: DATA_FILE,
    });
  }

  // 2. GET /api/v1/widgets — Список виджетов для Orta Mobile
  if (pathname === '/api/v1/widgets' && method === 'GET') {
    const userId = parsedUrl.searchParams.get('userId');
    // Сортировка по приоритету (высший приоритет первым)
    const sorted = [...widgetsStore].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    return sendJson(res, 200, {
      success: true,
      userId: userId || 'anonymous',
      data: sorted,
    });
  }

  // 3. POST /api/v1/widgets/publish — Публикация/обновление от стороннего сервиса
  if (pathname === '/api/v1/widgets/publish' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { targetUser, externalId, widget } = body;

      if (!widget || !widget.appId || !widget.template || !widget.title) {
        return sendJson(res, 400, {
          success: false,
          error: 'Missing required fields: widget.appId, widget.template, widget.title',
        });
      }

      const widgetId = widget.id || (externalId ? `widget-${widget.appId}-${externalId}` : `widget-${crypto.randomUUID()}`);

      const newWidget = {
        id: widgetId,
        externalId: externalId || widget.externalId,
        appId: widget.appId,
        appName: widget.appName || widget.appId,
        template: widget.template,
        title: widget.title,
        subtitle: widget.subtitle || '',
        badgeText: widget.badgeText,
        badgeVariant: widget.badgeVariant || 'neutral',
        counter: widget.counter,
        options: widget.options,
        progress: widget.progress,
        statusText: widget.statusText,
        actionText: widget.actionText || 'Открыть →',
        actionUrl: widget.actionUrl || '/',
        priority: typeof widget.priority === 'number' ? widget.priority : 50,
        updatedAt: new Date().toISOString(),
      };

      // Ищем существующий (по id или externalId + appId)
      const existingIndex = widgetsStore.findIndex(
        w => w.id === widgetId || (externalId && w.externalId === externalId && w.appId === widget.appId)
      );

      if (existingIndex !== -1) {
        widgetsStore[existingIndex] = { ...widgetsStore[existingIndex], ...newWidget };
        saveWidgets(widgetsStore);
        console.log(`[WidgetService] Updated widget: ${newWidget.id} (${newWidget.title})`);
        return sendJson(res, 200, {
          success: true,
          action: 'updated',
          widget: widgetsStore[existingIndex],
        });
      } else {
        widgetsStore.unshift(newWidget);
        saveWidgets(widgetsStore);
        console.log(`[WidgetService] Published new widget: ${newWidget.id} (${newWidget.title})`);
        return sendJson(res, 201, {
          success: true,
          action: 'created',
          widget: newWidget,
        });
      }
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 4. DELETE /api/v1/widgets/:id — Удаление виджета
  if (pathname.startsWith('/api/v1/widgets/') && method === 'DELETE') {
    const idToDelete = decodeURIComponent(pathname.replace('/api/v1/widgets/', ''));
    const initialLen = widgetsStore.length;
    
    widgetsStore = widgetsStore.filter(w => w.id !== idToDelete && w.externalId !== idToDelete);

    if (widgetsStore.length < initialLen) {
      saveWidgets(widgetsStore);
      console.log(`[WidgetService] Deleted widget: ${idToDelete}`);
      return sendJson(res, 200, { success: true, deletedId: idToDelete });
    } else {
      return sendJson(res, 404, { success: false, error: `Widget with id "${idToDelete}" not found` });
    }
  }

  // 5. POST /api/v1/widgets/reset — Сброс к исходному мок-списку
  if (pathname === '/api/v1/widgets/reset' && method === 'POST') {
    widgetsStore = [...INITIAL_WIDGETS];
    saveWidgets(widgetsStore);
    console.log('[WidgetService] Reset widgets to initial state and saved to disk');
    return sendJson(res, 200, {
      success: true,
      message: 'Widgets reset to initial mock data',
      data: widgetsStore,
    });
  }

  // 404 Not Found
  return sendJson(res, 404, {
    error: 'Endpoint not found',
    routes: [
      'GET  /health',
      'GET  /api/v1/widgets',
      'POST /api/v1/widgets/publish',
      'DELETE /api/v1/widgets/:id',
      'POST /api/v1/widgets/reset',
    ],
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Orta Widget Hub is running on http://localhost:${PORT}`);
  console.log(`💾 Data stored at: ${DATA_FILE}`);
  console.log(`📡 GET    http://localhost:${PORT}/api/v1/widgets`);
  console.log(`📝 POST   http://localhost:${PORT}/api/v1/widgets/publish`);
  console.log(`🗑️  DELETE http://localhost:${PORT}/api/v1/widgets/:id`);
  console.log(`🔄 POST   http://localhost:${PORT}/api/v1/widgets/reset\n`);
});
