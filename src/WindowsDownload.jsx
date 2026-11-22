const INSTALLER_URL = 'https://github.com/jdarkyeka6/wavo-cleaned/releases/latest/download/Wavo-Setup.exe'
const RELEASES_URL = 'https://github.com/jdarkyeka6/wavo-cleaned/releases/latest'

export default function WindowsDownload() {
  return (
    <main style={{ minHeight: '100dvh', background: 'radial-gradient(circle at 20% 10%, #343060 0%, #14131f 46%, #0c0b12 100%)', color: '#fff', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Outfit, system-ui, sans-serif' }}>
      <div style={{ width: 'min(100%, 540px)', textAlign: 'center' }}>
        <img src="/favicon.svg" alt="Wavo" width="88" height="88" style={{ borderRadius: 20 }} />
        <h1 style={{ fontSize: 'clamp(2rem,6vw,3.5rem)', margin: '18px 0 8px' }}>Wavo for Windows</h1>
        <p style={{ color: '#c5c1d4', fontSize: '1.12rem', lineHeight: 1.6 }}>Your chats, friends and groups, now in a Windows desktop app.</p>
        <a href={INSTALLER_URL} style={{ display: 'inline-block', background: 'linear-gradient(110deg,#9c35ff,#4c7cff)', color: '#fff', padding: '16px 30px', borderRadius: 14, fontWeight: 700, textDecoration: 'none', margin: '20px 0 12px' }}>Download for Windows (.exe)</a>
        <p style={{ color: '#b9b5c8', fontSize: '.94rem' }}>For Windows 10 and 11, 64-bit. Downloads are hosted on our official GitHub Releases page.</p>
        <p style={{ color: '#b9b5c8', fontSize: '.92rem', lineHeight: 1.6 }}>Early versions may display a Microsoft SmartScreen publisher warning while Wavo builds signing reputation. Only install downloads from the official release page, and don't disable antivirus protection.</p>
        <p style={{ marginTop: 24 }}><a href={RELEASES_URL} style={{ color: '#c2a0ff' }}>View the latest release</a> <span style={{ color: '#777' }}>·</span> <a href="/" style={{ color: '#c2a0ff' }}>Back to Wavo</a></p>
      </div>
    </main>
  )
}
