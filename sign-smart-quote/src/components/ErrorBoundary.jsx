import { Component } from "react";

// Wraps the whole app (see App.jsx) — without this, any uncaught render
// exception anywhere blanks the entire tab with no explanation and no way
// back in short of knowing to hit refresh.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary] uncaught render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="text-center max-w-sm space-y-4">
            <p className="text-lg font-bold text-slate-800">משהו השתבש</p>
            <p className="text-sm text-slate-500">אירעה שגיאה בלתי צפויה בממשק. רענון הדף בדרך כלל פותר את זה.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
            >
              רענן את הדף
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
