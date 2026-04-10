import React from 'react';

const navLinks = [
  { label: 'How it works', href: '#how' },
  { label: 'Why this works', href: '#why' },
  { label: 'Use cases', href: '#use-cases' },
  { label: 'FAQ', href: '#faq' },
];

const differentiators = [
  {
    title: 'Intent, not impressions',
    copy: 'SyntraeAI listens for real buying questions already happening inside comments, not vanity reach or cold traffic.',
  },
  {
    title: 'Demand before competitors see it',
    copy: 'You can spot emerging customer needs as they show up, before the algorithm buries them under new posts.',
  },
  {
    title: 'Built for operators, not analysts',
    copy: 'Every signal is routed into a simple follow-up flow with the original comment context intact.',
  },
  {
    title: 'Better than more ads',
    copy: 'If you are tired of paying for empty clicks, this replaces wasted spend with actual conversations.',
  },
];

const useCases = [
  {
    title: 'Beauty & skincare sellers',
    copy: 'Capture questions about ingredients, results, and suitability while shoppers are still deciding.',
  },
  {
    title: 'Local service businesses',
    copy: 'Find people asking for prices, availability, and recommendations in your area.',
  },
  {
    title: 'Founders testing offers',
    copy: 'Identify early demand signals without overinvesting in ads or content.',
  },
  {
    title: 'Retail and product brands',
    copy: 'Turn comment traffic into qualified leads you can actually follow up with.',
  },
];

const faqs = [
  {
    q: 'What is SyntraeAI?',
    a: 'SyntraeAI is a demand capture platform that finds high-intent customers from social conversations and routes them into a follow-up workflow.',
  },
  {
    q: 'Is this just another automation tool?',
    a: 'No. The core value is intent discovery. Automation only comes after you find real demand signals worth responding to.',
  },
  {
    q: 'Where does SyntraeAI work today?',
    a: 'SyntraeAI is strongest on Xiaohongshu/Rednote workflows, with expansion paths to additional social channels.',
  },
  {
    q: 'Do I need to run ads to benefit?',
    a: 'No. It is built for the comments people already leave — the ones that often go unanswered or unnoticed.',
  },
];

export default function App() {
  return (
    <div className="bg-mist text-ink">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white via-white to-emerald-50" />
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute -left-24 top-40 h-72 w-72 rounded-full bg-sky-200/20 blur-3xl" />

        <header className="relative hero-shell py-8">
          <nav className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo-mark.svg" alt="SyntraeAI" className="h-10 w-10" />
              <span className="font-display text-lg font-semibold">SyntraeAI</span>
            </div>
            <div className="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex">
              {navLinks.map((link) => (
                <a key={link.href} href={link.href} className="transition hover:text-ink">
                  {link.label}
                </a>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <a className="button-secondary" href="/app">Open Console</a>
              <a className="button-primary" href="/signup">Start Free</a>
            </div>
          </nav>
        </header>

        <HeroSection />
      </div>

      <section id="problem" className="section-shell py-20">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <span className="section-kicker">The frustration</span>
            <h2 className="section-title">Most marketing spend goes to people who were never looking.</h2>
            <p className="text-base text-slate-600">
              Ads, content, and promo campaigns are expensive. Even when views rise, the leads rarely do. Meanwhile, real customers are already asking
              questions in social comments — and the opportunity disappears if you miss them.
            </p>
          </div>
          <div className="card-surface p-6">
            <h3 className="text-lg font-semibold text-ink">Common signals brands miss</h3>
            <ul className="mt-5 space-y-3 text-sm text-slate-600">
              <li>“Is this suitable for sensitive skin?”</li>
              <li>“How much is the package for couples?”</li>
              <li>“Can you deliver to Penang?”</li>
              <li>“Does it work for acne scars?”</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="why" className="section-shell py-20">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-4">
            <span className="section-kicker">Why traditional marketing fails</span>
            <h2 className="section-title">Attention is expensive. Intent is already there.</h2>
            <p className="text-base text-slate-600">
              The best prospects are not convinced by ads — they are already looking for answers. SyntraeAI surfaces that intent, so your team can respond
              while the customer still cares.
            </p>
          </div>
          <div className="grid gap-4">
            {[
              'Ads are bidding wars. Comments are owned demand.',
              'Content fatigue slows growth. Intent signals stay evergreen.',
              'Views do not equal revenue. Questions do.',
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="section-shell py-20">
        <div className="flex flex-col gap-10">
          <div className="space-y-4">
            <span className="section-kicker">How SyntraeAI works</span>
            <h2 className="section-title">Find, qualify, and act on demand in one flow.</h2>
            <p className="text-base text-slate-600">SyntraeAI keeps the original comment context so operators can reply fast and build trust.</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Detect intent signals',
                copy: 'SyntraeAI monitors social comment threads to capture high-intent questions and buying signals.',
              },
              {
                step: '02',
                title: 'Qualify the lead',
                copy: 'Each signal is classified and routed into a clear follow-up queue with urgency and context.',
              },
              {
                step: '03',
                title: 'Reply while it is hot',
                copy: 'Operators follow up with confidence, using the original comment and a suggested response outline.',
              },
            ].map((item) => (
              <div key={item.step} className="card-surface p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{item.step}</div>
                <h3 className="mt-4 text-xl font-semibold text-ink">{item.title}</h3>
                <p className="mt-3 text-sm text-slate-600">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="differentiators" className="section-shell py-20">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <span className="section-kicker">Why SyntraeAI</span>
            <h2 className="section-title">A demand engine, not another dashboard.</h2>
            <p className="text-base text-slate-600">
              SyntraeAI is designed to help businesses capture live intent. It is a better alternative to buying more ads or chasing trend-driven content.
            </p>
          </div>
          <div className="grid gap-4">
            {differentiators.map((item) => (
              <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="section-shell py-20">
        <div className="space-y-10">
          <div className="space-y-4">
            <span className="section-kicker">Who it is for</span>
            <h2 className="section-title">Built for businesses that need real leads, not more noise.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {useCases.map((item) => (
              <div key={item.title} className="card-surface p-6">
                <h3 className="text-lg font-semibold text-ink">{item.title}</h3>
                <p className="mt-3 text-sm text-slate-600">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="proof" className="section-shell py-20">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <span className="section-kicker">Credibility</span>
            <h2 className="section-title">Designed for high-intent social workflows.</h2>
            <p className="text-base text-slate-600">
              SyntraeAI keeps comment context intact, prioritizes urgency, and helps teams respond fast. The platform is optimized for Xiaohongshu/Rednote
              operators today and expanding for broader social channels.
            </p>
          </div>
          <div className="glass-panel p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Signal review</div>
            <div className="mt-5 space-y-4">
              {[
                'Intent score attached to each comment',
                'Buyer stage and urgency shown up front',
                'No context loss between capture and reply',
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="section-shell py-20">
        <div className="space-y-8">
          <div className="space-y-4">
            <span className="section-kicker">FAQ</span>
            <h2 className="section-title">Clear answers before you start.</h2>
          </div>
          <div className="grid gap-4">
            {faqs.map((item) => (
              <div key={item.q} className="card-surface p-6">
                <h3 className="text-base font-semibold text-ink">{item.q}</h3>
                <p className="mt-3 text-sm text-slate-600">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-shell py-20">
        <div className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-ink px-8 py-12 text-white shadow-glow">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <h2 className="font-display text-3xl font-semibold">Stop chasing attention. Start capturing demand.</h2>
              <p className="text-sm text-white/70">
                Your next customer is already asking. SyntraeAI helps you show up first.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a className="button-primary" href="/signup">Start Free</a>
              <a className="button-secondary" href="/app">Open Console</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="section-shell pb-12 pt-6 text-sm text-slate-500">
        <div className="flex flex-col gap-4 border-t border-slate-200 pt-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-mark-mono.svg" alt="SyntraeAI" className="h-8 w-8" />
            <span>SyntraeAI</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <a href="/privacy" className="hover:text-ink">Privacy</a>
            <a href="/terms" className="hover:text-ink">Terms</a>
            <a href="mailto:team@syntrae.ai" className="hover:text-ink">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.05),transparent_28%)]" />

      <div className="relative mx-auto max-w-[1280px] px-6 pb-24 pt-28 sm:px-8 lg:px-12 lg:pb-28 lg:pt-32">
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600 backdrop-blur">
              Real demand, not empty traffic
            </div>

            <h1 className="mt-7 max-w-[11ch] text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl lg:leading-[0.95]">
              The best customers are already asking.
            </h1>

            <p className="mt-6 max-w-2xl text-xl font-medium leading-relaxed text-slate-700 lg:text-2xl">
              Most businesses never see them. SyntraeAI helps you find and act on them first.
            </p>

            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600 lg:text-lg">
              Customers are already asking questions in comments, threads, and social conversations.
              Instead of chasing cold traffic, SyntraeAI helps you respond to real demand while it is still fresh.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="/signup"
                className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Find customers already asking
              </a>

              <a
                href="#how"
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-50"
              >
                See how it works
              </a>
            </div>

            <p className="mt-6 text-sm text-slate-500">
              Built for operators who want qualified leads, not vanity views.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              {[
                'No more empty views',
                'Find demand earlier',
                'Keep conversation context',
              ].map((item) => (
                <div
                  key={item}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="rounded-[32px] border border-slate-200 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6 lg:p-7">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Intent signal board
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Live questions with buying intent, captured before they go cold.
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
                  Live
                </span>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <SignalCard
                  label="High intent"
                  title="“Does this work for sensitive skin?”"
                  meta="Skincare · Comment thread"
                  note="Captured as a qualified lead with follow-up context."
                />
                <SignalCard
                  label="Ready to buy"
                  title="“Where can I order and how fast can it ship?”"
                  meta="Local service · Inquiry"
                  note="Prioritized for immediate response."
                />
                <SignalCard
                  label="Comparison"
                  title="“Is this better than the clinic near me?”"
                  meta="Beauty · Competitive intent"
                  note="Flagged for owner review with buying context."
                />
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <OutcomeCard
                  eyebrow="Qualified today"
                  title="18 new intent leads"
                  aside="+7 high intent"
                />
                <OutcomeCard
                  eyebrow="Next action"
                  title="Reply drafts ready"
                  aside="With context"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SignalCard({
  label,
  title,
  meta,
  note,
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
          {label}
        </p>
      </div>
      <p className="mt-4 text-base font-semibold leading-7 text-slate-900">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{meta}</p>
      <p className="mt-4 text-sm leading-6 text-slate-600">{note}</p>
    </div>
  );
}

function OutcomeCard({
  eyebrow,
  title,
  aside,
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            {eyebrow}
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{title}</p>
        </div>
        <span className="text-sm font-semibold text-emerald-600">{aside}</span>
      </div>
    </div>
  );
}
