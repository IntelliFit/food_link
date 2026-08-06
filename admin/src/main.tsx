import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { App } from './App'
import './styles.css'

const rootElement = document.getElementById('root')!

// index.html provides a pre-React loading shell. Remove it before mounting so
// it cannot remain in the document flow and push the admin page down by 100vh.
rootElement.replaceChildren()

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider attribute='class' defaultTheme='system' enableSystem disableTransitionOnChange={false}>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
