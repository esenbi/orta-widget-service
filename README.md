# Orta Widget Hub (Service Demo)

Автономный сервис приёма и отдачи виджетов для мобильного приложения **Orta Super-App**.

## Особенности
* Чистый Node.js без сторонних зависимостей.
* **Сохранение данных на диске**: автоматически сохраняет все виджеты в `data/widgets.json` (переживает перезапуски сервера).
* Готов к 1-click деплою на **Render.com**.

---

## Локальный запуск

```bash
cd orta-widget-service
node server.js
```

Сервер запустится на `http://localhost:4000`. При первом запуске автоматически создастся файл `data/widgets.json` с начальными данными.

---

## Деплой на Render.com (Бесплатно)

1. Создай новый репозиторий на GitHub и запушь туда содержимое этой папки (`orta-widget-service`).
2. Зайди на [dashboard.render.com](https://dashboard.render.com) $\to$ **New +** $\to$ **Web Service**.
3. Подключи свой репозиторий.
4. Настройки:
   * **Runtime**: `Node`
   * **Build Command**: *(оставь пустым)*
   * **Start Command**: `node server.js`
   * **Instance Type**: `Free`
5. Нажми **Create Web Service**.
6. Через 1 минуту Render выдаст тебе публичный HTTPS-адрес, например:
   `https://orta-widget-service.onrender.com`

### Как подключить к мобильному приложению Orta:
В файле `src/shared/api/services/widget_service.ts` просто замени локальный адрес на полученный с Render:
```typescript
export const WIDGET_SERVICE_BASE_URL = 'https://orta-widget-service.onrender.com/api/v1';
```

---

## API Эндпоинты

| Метод | Путь | Описание |
| :--- | :--- | :--- |
| `GET` | `/health` | Проверка работоспособности сервиса |
| `GET` | `/api/v1/widgets` | Получить список виджетов для приложения |
| `POST` | `/api/v1/widgets/publish` | Опубликовать/обновить виджет от мини-аппа |
| `DELETE` | `/api/v1/widgets/:id` | Удалить виджет |
| `POST` | `/api/v1/widgets/reset` | Сбросить к исходным мок-данным |

---

## Примеры cURL

### 1. Получить виджеты
```bash
curl http://localhost:4000/api/v1/widgets
```

### 2. Опубликовать / обновить виджет
```bash
curl -X POST http://localhost:4000/api/v1/widgets/publish \
  -H "Content-Type: application/json" \
  -d '{
    "externalId": "doc-urgent-77",
    "widget": {
      "appId": "sed",
      "appName": "СЭД: Документы",
      "template": "approval",
      "title": "Срочный договор аренды #77",
      "subtitle": "Требуется визирование до 18:00",
      "badgeText": "Срочно",
      "badgeVariant": "warning",
      "actionText": "Открыть в СЭД →",
      "actionUrl": "/documents/77",
      "priority": 95
    }
  }'
```

### 3. Удалить виджет
```bash
curl -X DELETE http://localhost:4000/api/v1/widgets/doc-urgent-77
```
