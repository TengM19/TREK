import { useState } from 'react'

/** Build-time opt-in: ordinary upstream installations render no notice. */
export default function RuntimePreviewNotice() {
  const [visible, setVisible] = useState(true)
  if (import.meta.env.VITE_RUNTIME_PREVIEW !== 'cloudflare' || !visible) return null
  return (
    <aside aria-label="Cloudflare preview limitations" style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10000, width: 'min(620px, calc(100vw - 32px))', background: '#132a27', color: '#fff', border: '1px solid #66978b', borderRadius: 12, padding: '12px 40px 12px 16px', boxShadow: '0 4px 20px #0003', fontSize: 12 }}>
      <strong>Cloudflare 预览版</strong> · 行程、地点和日程可保存，实时协作与定时任务已启用。附件、PDF 导入和插件暂未开放。 <a href="/cloudflare-source.tar.gz" style={{color:"#b9efdf",textDecoration:"underline"}}>对应源码</a>
      <button type="button" aria-label="关闭预览提示" onClick={() => setVisible(false)} style={{ position: 'absolute', right: 12, top: 10, color: 'inherit', fontSize: 20 }}>×</button>
    </aside>
  )
}
