import { render, screen } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import App from './App'

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

describe('App', () => {
  it('renders tab navigation', () => {
    renderApp()
    expect(screen.getByRole('tab', { name: 'Set Workshop' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tagger' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument()
  })

  it('shows Set Workshop as default active tab', () => {
    renderApp()
    const tab = screen.getByRole('tab', { name: 'Set Workshop' })
    expect(tab).toHaveAttribute('data-state', 'active')
  })
})
