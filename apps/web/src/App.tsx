import MapExplorer from './features/map/components/MapExplorer'
import { ExplicacaoProvider } from './features/educacao/explicacao-ui'
import './App.css'

function App() {
  return (
    <ExplicacaoProvider>
      <main className="observatorio"><MapExplorer /></main>
    </ExplicacaoProvider>
  )
}

export default App
