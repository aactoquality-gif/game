let audio: HTMLAudioElement | null = null
let initialized = false
let musicEnabled = true

const STORAGE_KEY = 'game_music_enabled'

function readStoredState(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === null) return true
    return saved !== 'false'
  } catch {
    return true
  }
}

function persistState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(musicEnabled))
  } catch {
    // Игнорируем, если локалсторадж недоступен
  }
}

export function initBackgroundMusic(src = '/audio/background.mp3', volume = 0.25): void {
  if (initialized) return
  initialized = true

  musicEnabled = readStoredState()
  audio = new Audio(src)
  audio.loop = true
  audio.volume = musicEnabled ? volume : 0
  audio.preload = 'auto'

  const unlock = (): void => {
    if (!audio || !musicEnabled) return
    void audio.play().catch(() => {
      // Браузер / Telegram блокируют автозапуск до первого взаимодействия.
      // Далее музыка будет запущена после следующего клика или нажатия клавиши.
    })
  }

  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
  window.addEventListener('touchstart', unlock, { once: true })

  document.addEventListener('visibilitychange', () => {
    if (!audio) return
    if (document.visibilityState === 'hidden') {
      if (musicEnabled) audio.pause()
      return
    }
    if (musicEnabled) {
      void audio.play().catch(() => {})
    }
  })
}

export function setMusicEnabled(enabled: boolean): void {
  musicEnabled = enabled
  persistState()

  if (!audio) return
  audio.volume = enabled ? 0.25 : 0

  if (enabled) {
    void audio.play().catch(() => {})
  } else {
    audio.pause()
  }
}

export function isMusicEnabled(): boolean {
  return musicEnabled
}

export function toggleMusic(): boolean {
  setMusicEnabled(!musicEnabled)
  return musicEnabled
}
