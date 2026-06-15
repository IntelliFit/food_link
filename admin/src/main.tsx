import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider attribute='class' defaultTheme='system' enableSystem disableTransitionOnChange={false}>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
