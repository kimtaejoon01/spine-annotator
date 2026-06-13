import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Spine Annotator - 척추 X-ray 라벨링</title>

        {/* FontAwesome */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
        />

        {/* Konva.js - 캔버스 그래픽 라이브러리 */}
        <script src="https://cdn.jsdelivr.net/npm/konva@9.3.6/konva.min.js"></script>

        {/* 앱 전용 스타일 */}
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body>
        {children}
        {/* 앱 메인 스크립트 (모듈 분리) */}
        <script type="module" src="/static/app.js"></script>
      </body>
    </html>
  )
})
