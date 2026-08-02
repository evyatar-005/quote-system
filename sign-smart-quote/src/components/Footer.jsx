// Site-wide credit line. Deliberately quiet: it sits below the working area of
// every page, so it has to stay out of the way of people using the app all day.
export default function Footer() {
  return (
    <footer dir="rtl" className="mt-10 border-t border-slate-200">
      <div className="h-1 w-full flex opacity-60">
        <div className="flex-1 bg-brand-pink" />
        <div className="flex-1 bg-brand-gold" />
        <div className="flex-1 bg-brand-teal" />
        <div className="flex-1 bg-brand-green" />
        <div className="flex-1 bg-brand-purple" />
      </div>
      <p className="py-4 text-center text-xs text-slate-400">
        נבנה ומתוחזק ע״י אביתר אבינועם
      </p>
    </footer>
  );
}
