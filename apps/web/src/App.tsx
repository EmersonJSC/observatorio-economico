import MapExplorer from './features/map/components/MapExplorer'
import { ExplicacaoProvider } from './features/educacao/explicacao-ui'
import { TemporalProvider } from './features/timeline/TemporalContext'
import GlobalTimeline from './features/timeline/GlobalTimeline'
import './App.css'

function App() {
  return (
    <TemporalProvider>
      <ExplicacaoProvider>
        <main className="observatorio"><MapExplorer /><GlobalTimeline /></main>
      </ExplicacaoProvider>
    </TemporalProvider>
  )
}

export default App
