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
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4005;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'widgets.json');

// По умолчанию список пуст — виджеты создаются динамически через мини-приложения
const INITIAL_WIDGETS = [];

const ALLOWED_TEMPLATES = new Set([
  'metric',
  'event',
  'poll',
  'approval',
  'progress',
  'list',
  'banner',
]);

const ALLOWED_BADGE_VARIANTS = new Set([
  'accent',
  'warning',
  'success',
  'danger',
  'error',
  'neutral',
]);

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 часа по умолчанию

/**
 * Расчёт даты деактивации виджета (expiresAt).
 * - ttlSeconds === 0 или -1 -> null (бессрочный)
 * - expiresAt (валидная ISO дата) -> expiresAt
 * - ttlSeconds (> 0) -> now + ttlSeconds
 * - иначе -> now + DEFAULT_TTL_SECONDS (24 часа)
 */
function calculateExpiresAt(widget) {
  if (widget.ttlSeconds === 0 || widget.ttlSeconds === -1) {
    return null;
  }
  if (widget.expiresAt && typeof widget.expiresAt === 'string') {
    const parsed = new Date(widget.expiresAt);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const seconds =
    typeof widget.ttlSeconds === 'number' && widget.ttlSeconds > 0
      ? widget.ttlSeconds
      : DEFAULT_TTL_SECONDS;

  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Валидация структуры виджета перед публикацией/обновлением.
 * Возвращает массив строк с ошибками. Если массив пуст — валидация пройдена успешно.
 */
function validateWidgetPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    errors.push('Request body must be a JSON object');
    return errors;
  }

  const { externalId, widget } = payload;

  if (externalId !== undefined && externalId !== null) {
    if (typeof externalId !== 'string' || !externalId.trim()) {
      errors.push("'externalId' must be a non-empty string when provided");
    } else if (externalId.length > 100) {
      errors.push("'externalId' exceeds maximum length of 100 characters");
    }
  }

  if (!widget || typeof widget !== 'object') {
    errors.push("'widget' field is required and must be an object");
    return errors;
  }

  // 1. Обязательные базовые поля
  if (!widget.appId || typeof widget.appId !== 'string' || !widget.appId.trim()) {
    errors.push("'widget.appId' is required and must be a non-empty string");
  } else if (widget.appId.length > 100) {
    errors.push("'widget.appId' exceeds maximum length of 100 characters");
  }

  if (!widget.template || typeof widget.template !== 'string') {
    errors.push("'widget.template' is required and must be a string");
  } else if (!ALLOWED_TEMPLATES.has(widget.template)) {
    errors.push(
      `'widget.template' "${widget.template}" is invalid. Allowed: ${Array.from(ALLOWED_TEMPLATES).join(', ')}`
    );
  }

  if (!widget.title || typeof widget.title !== 'string' || !widget.title.trim()) {
    errors.push("'widget.title' is required and must be a non-empty string");
  } else if (widget.title.length > 150) {
    errors.push("'widget.title' exceeds maximum length of 150 characters");
  }

  // 2. Необязательные общие поля
  if (widget.subtitle !== undefined && widget.subtitle !== null) {
    if (typeof widget.subtitle !== 'string') {
      errors.push("'widget.subtitle' must be a string");
    } else if (widget.subtitle.length > 200) {
      errors.push("'widget.subtitle' exceeds maximum length of 200 characters");
    }
  }

  if (widget.badgeText !== undefined && widget.badgeText !== null) {
    if (typeof widget.badgeText !== 'string') {
      errors.push("'widget.badgeText' must be a string");
    } else if (widget.badgeText.length > 50) {
      errors.push("'widget.badgeText' exceeds maximum length of 50 characters");
    }
  }

  if (widget.badgeVariant !== undefined && widget.badgeVariant !== null) {
    if (typeof widget.badgeVariant !== 'string' || !ALLOWED_BADGE_VARIANTS.has(widget.badgeVariant)) {
      errors.push(
        `'widget.badgeVariant' "${widget.badgeVariant}" is invalid. Allowed: ${Array.from(ALLOWED_BADGE_VARIANTS).join(', ')}`
      );
    }
  }

  if (widget.actionText !== undefined && widget.actionText !== null) {
    if (typeof widget.actionText !== 'string') {
      errors.push("'widget.actionText' must be a string");
    } else if (widget.actionText.length > 50) {
      errors.push("'widget.actionText' exceeds maximum length of 50 characters");
    }
  }

  if (widget.actionUrl !== undefined && widget.actionUrl !== null) {
    if (typeof widget.actionUrl !== 'string') {
      errors.push("'widget.actionUrl' must be a string");
    } else if (widget.actionUrl.length > 1000) {
      errors.push("'widget.actionUrl' exceeds maximum length of 1000 characters");
    }
  }

  if (widget.priority !== undefined && widget.priority !== null) {
    if (typeof widget.priority !== 'number' || isNaN(widget.priority) || widget.priority < 0 || widget.priority > 100) {
      errors.push("'widget.priority' must be a number between 0 and 100");
    }
  }

  if (widget.ttlSeconds !== undefined && widget.ttlSeconds !== null) {
    if (typeof widget.ttlSeconds !== 'number' || isNaN(widget.ttlSeconds)) {
      errors.push("'widget.ttlSeconds' must be a number (seconds, e.g. 3600; 0 or -1 for permanent)");
    }
  }

  if (widget.expiresAt !== undefined && widget.expiresAt !== null) {
    if (typeof widget.expiresAt !== 'string' || isNaN(new Date(widget.expiresAt).getTime())) {
      errors.push("'widget.expiresAt' must be a valid ISO date string (e.g. 2026-10-28T18:00:00Z)");
    }
  }

  // 3. Специфичные поля по шаблонам
  if (widget.template === 'metric') {
    if (widget.counter !== undefined && widget.counter !== null) {
      if (typeof widget.counter !== 'number' || isNaN(widget.counter)) {
        errors.push("'widget.counter' must be a number for 'metric' template");
      }
    }
  }

  if (widget.template === 'progress') {
    if (widget.progress === undefined || widget.progress === null || typeof widget.progress !== 'number' || isNaN(widget.progress)) {
      errors.push("'widget.progress' is required for 'progress' template and must be a number (0..100)");
    } else if (widget.progress < 0 || widget.progress > 100) {
      errors.push("'widget.progress' must be between 0 and 100");
    }
  }

  if (widget.template === 'poll') {
    if (!Array.isArray(widget.options) || widget.options.length < 2) {
      errors.push("'widget.options' is required for 'poll' template and must contain at least 2 options");
    } else {
      widget.options.forEach((opt, idx) => {
        if (!opt || typeof opt !== 'object' || !opt.text || typeof opt.text !== 'string' || !opt.text.trim()) {
          errors.push(`'widget.options[${idx}].text' must be a non-empty string`);
        }
        if (opt.percentage !== undefined && (typeof opt.percentage !== 'number' || opt.percentage < 0 || opt.percentage > 100)) {
          errors.push(`'widget.options[${idx}].percentage' must be a number between 0 and 100`);
        }
      });
    }
  }

  return errors;
}

/**
 * Файловое хранилище (Persistence)
 */
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {recursive: true});
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(INITIAL_WIDGETS, null, 2),
      'utf-8',
    );
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
    console.error(
      '[Storage] Error loading widgets from file, using initial:',
      err.message,
    );
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
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',
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
  const parsedUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`,
  );
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Обработка Preflight CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Requested-With',
    });
    return res.end();
  }

  // 1. Healthcheck
  if (pathname === '/health' && method === 'GET') {
    const now = Date.now();
    const activeCount = widgetsStore.filter(
      w => !w.expiresAt || new Date(w.expiresAt).getTime() > now,
    ).length;

    return sendJson(res, 200, {
      status: 'ok',
      service: 'orta-widget-service',
      time: new Date().toISOString(),
      activeWidgetsCount: activeCount,
      totalStoredWidgets: widgetsStore.length,
      defaultTtlSeconds: DEFAULT_TTL_SECONDS,
      storageFile: DATA_FILE,
    });
  }

  // 2. GET /api/v1/widgets — Список виджетов для Orta Mobile
  if (pathname === '/api/v1/widgets' && method === 'GET') {
    const userId = parsedUrl.searchParams.get('userId');
    const now = Date.now();

    // 1. Фильтруем просроченные виджеты (TTL)
    const activeWidgets = widgetsStore.filter(w => {
      if (!w.expiresAt) return true; // бессрочный (ttlSeconds: 0 / -1)
      return new Date(w.expiresAt).getTime() > now;
    });

    // 2. Двухуровневая сортировка: сначала по priority, затем самое свежее (updatedAt/createdAt) первым!
    const sorted = [...activeWidgets].sort((a, b) => {
      const pDiff = (b.priority ?? 50) - (a.priority ?? 50);
      if (pDiff !== 0) return pDiff;

      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

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
      const validationErrors = validateWidgetPayload(body);

      if (validationErrors.length > 0) {
        console.warn(
          '[WidgetService] Validation failed on /publish:',
          validationErrors,
        );
        return sendJson(res, 400, {
          success: false,
          error: validationErrors[0],
          details: validationErrors,
        });
      }

      const {externalId, widget} = body;

      const widgetId =
        widget.id ||
        (externalId
          ? `widget-${widget.appId}-${externalId}`
          : `widget-${crypto.randomUUID()}`);

      // Ищем существующий (по id или externalId + appId)
      const existingIndex = widgetsStore.findIndex(
        w =>
          w.id === widgetId ||
          (externalId &&
            w.externalId === externalId &&
            w.appId === widget.appId),
      );

      const existingWidget =
        existingIndex !== -1 ? widgetsStore[existingIndex] : null;
      const createdAt = existingWidget?.createdAt || new Date().toISOString();
      const updatedAt = new Date().toISOString();
      const expiresAt = calculateExpiresAt(widget);

      const newWidget = {
        id: widgetId,
        externalId: externalId || widget.externalId || undefined,
        appId: widget.appId,
        appName: widget.appName || widget.appId,
        template: widget.template,
        title: widget.title.trim(),
        subtitle: widget.subtitle ? widget.subtitle.trim() : undefined,
        badgeText: widget.badgeText ? widget.badgeText.trim() : undefined,
        badgeVariant: widget.badgeVariant || 'neutral',
        counter: typeof widget.counter === 'number' ? widget.counter : undefined,
        options: Array.isArray(widget.options) ? widget.options : undefined,
        progress: typeof widget.progress === 'number' ? widget.progress : undefined,
        statusText: widget.statusText ? widget.statusText.trim() : undefined,
        actionText: widget.actionText ? widget.actionText.trim() : undefined,
        actionUrl: widget.actionUrl ? widget.actionUrl.trim() : undefined,
        priority: typeof widget.priority === 'number' ? widget.priority : 50,
        ttlSeconds: typeof widget.ttlSeconds === 'number' ? widget.ttlSeconds : undefined,
        expiresAt,
        createdAt,
        updatedAt,
      };

      if (existingIndex !== -1) {
        // Перемещаем обновленный виджет наверх списка (LIFO)
        widgetsStore.splice(existingIndex, 1);
        widgetsStore.unshift(newWidget);
        saveWidgets(widgetsStore);
        console.log(
          `[WidgetService] Updated widget: ${newWidget.id} (${newWidget.title})`,
        );
        return sendJson(res, 200, {
          success: true,
          action: 'updated',
          widget: newWidget,
        });
      } else {
        widgetsStore.unshift(newWidget);
        saveWidgets(widgetsStore);
        console.log(
          `[WidgetService] Published new widget: ${newWidget.id} (${newWidget.title})`,
        );
        return sendJson(res, 201, {
          success: true,
          action: 'created',
          widget: newWidget,
        });
      }
    } catch (err) {
      return sendJson(res, 400, {success: false, error: err.message});
    }
  }

  // 4. DELETE /api/v1/widgets/:id — Удаление виджета
  if (pathname.startsWith('/api/v1/widgets/') && method === 'DELETE') {
    const idToDelete = decodeURIComponent(
      pathname.replace('/api/v1/widgets/', ''),
    );
    const initialLen = widgetsStore.length;

    widgetsStore = widgetsStore.filter(
      w => w.id !== idToDelete && w.externalId !== idToDelete,
    );

    if (widgetsStore.length < initialLen) {
      saveWidgets(widgetsStore);
      console.log(`[WidgetService] Deleted widget: ${idToDelete}`);
      return sendJson(res, 200, {success: true, deletedId: idToDelete});
    } else {
      return sendJson(res, 404, {
        success: false,
        error: `Widget with id "${idToDelete}" not found`,
      });
    }
  }

  // 5. POST /api/v1/widgets/reset — Сброс к исходному мок-списку
  if (pathname === '/api/v1/widgets/reset' && method === 'POST') {
    widgetsStore = [...INITIAL_WIDGETS];
    saveWidgets(widgetsStore);
    console.log(
      '[WidgetService] Reset widgets to initial state and saved to disk',
    );
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
