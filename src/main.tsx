import React, { type ErrorInfo, type ReactNode } from 'react'; import { createRoot } from 'react-dom/client'; import App from './App'; import './styles.css';

class AppErrorBoundary extends React.Component<{children:ReactNode},{hasError:boolean}> {
  state={hasError:false};
  static getDerivedStateFromError(){return {hasError:true}}
  componentDidCatch(error:Error,info:ErrorInfo){console.error('AICTE dashboard render failed',error,info.componentStack)}
  render(){if(this.state.hasError)return <main className="fatal-error" role="alert"><div><h1>Dashboard could not load</h1><p>Something interrupted the page. Reload the dashboard to try again.</p><button className="button primary" onClick={()=>window.location.reload()}>Reload dashboard</button></div></main>;return this.props.children}
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App/></AppErrorBoundary></React.StrictMode>);
