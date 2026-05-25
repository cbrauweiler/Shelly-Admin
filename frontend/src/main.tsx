import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query'
import App from './App'
import { fetchState, UnauthorizedError, type AppState } from './api'
import './index.css'

async function bootstrap() {
  let state: AppState
  try {
    state = await fetchState()
  } catch {
    state = { needsSetup: false, authed: false, controlMode: 'monitor', refreshSeconds: 15, defaultSubnet: '' }
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err) => {
        if (err instanceof UnauthorizedError) {
          window.dispatchEvent(new CustomEvent('sa:unauthorized'))
        }
      },
    }),
    defaultOptions: {
      queries: {
        refetchInterval: state.refreshSeconds * 1000,
        staleTime: Math.max(2000, state.refreshSeconds * 500),
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof UnauthorizedError) && count < 1,
      },
    },
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App initialState={state} />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

void bootstrap()
