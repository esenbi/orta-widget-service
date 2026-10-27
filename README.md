# Orta Widget Hub (Service Demo)

Автономный сервис приёма и отдачи виджетов для мобильного приложения **Orta Super-App**.

## Быстрый старт

Сервис написан на чистом Node.js (работает без сторонних зависимостей):

```bash
cd orta-widget-service
node server.js
# или в dev-режиме с автоперезапуском:
npm run dev
```

Сервер запустится на `http://localhost:4000`.

---

## Примеры запросов (cURL)

### 1. Получить виджеты для главного экрана мобильного приложения
```bash
curl http://localhost:4000/api/v1/widgets
```

---

### 2. Опубликовать / обновить виджет от стороннего сервиса (СЭД, HR, Опросы)
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

---

### 3. Удалить виджет (когда задача выполнена / документ подписан)
```bash
curl -X DELETE http://localhost:4000/api/v1/widgets/doc-urgent-77
```

---

### 4. Сбросить данные к исходным демонстрационным
```bash
curl -X POST http://localhost:4000/api/v1/widgets/reset
```
