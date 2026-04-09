import React from 'react';

const navLinks = [
  { label: 'How it works', href: '#how' },
  { label: 'Why this works', href: '#why' },
  { label: 'Use cases', href: '#use-cases' },
  { label: 'FAQ', href: '#faq' },
];

const intentSignals = [
  {
    tag: 'High intent',
    title: '“Does this work for sensitive skin?”',
    meta: 'Skincare · Comment thread',
    note: 'Captured as a qualified lead with follow-up prompt.',
  },
  {
    tag: 'Ready to buy',
    title: '“Where can I order and how fast can it ship?”',
    meta: 'Local service · Inquiry',
    note: 'Routed to the owner with a reply draft.',
  },
  {
    tag: 'Comparison',
    title: '“Is this better than the clinic near me?”',
    meta: 'Beauty · Competitive intent',
    note: 'Flagged for priority response.',
  },
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

        <section className="relative hero-shell pb-24 pt-28 lg:pb-28 lg:pt-32">
          <div className="grid gap-14 lg:grid-cols-[0.58fr_0.42fr]">
            <div className="space-y-8">
              <span className="highlight-pill">Customers are already asking</span>
              <div className="space-y-6">
                <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl lg:text-6xl">
                  The best customers are already asking.
                </h1>
                <p className="text-xl font-semibold text-slate-700">
                  Most businesses never see them. SyntraeAI helps you find and act on them first.
                </p>
                <p className="max-w-xl text-lg text-slate-600">
                  Customers are already asking questions about what you sell — in comments, threads, and conversations.
                  Instead of chasing cold traffic, SyntraeAI helps you respond to real demand.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a className="button-primary" href="/signup">Find customers already asking</a>
                <a className="button-secondary" href="#how">See how it works</a>
              </div>
              <p className="text-sm text-slate-500">
                Built for SMB owners, beauty sellers, and local businesses who need real leads.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  'Stop paying for empty views',
                  'Find demand before competitors do',
                  'Convert questions into follow-up',
                  'Keep the original comment context',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-8">
              <div className="glass-panel p-7">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Intent signals</span>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Live</span>
                </div>
                <div className="mt-6 space-y-5">
                  {intentSignals.map((card) => (
                    <div key={card.title} className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-emerald-50/40 p-5 shadow-soft">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-emerald-700">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        {card.tag}
                      </div>
                      <p className="mt-3 text-base font-semibold text-slate-800">{card.title}</p>
                      <p className="mt-1 text-xs text-slate-400">{card.meta}</p>
                      <p className="mt-3 text-xs text-slate-500">{card.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-surface p-7">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Pipeline view</div>
                <div className="mt-6 grid gap-4">
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-5 py-4">
                    <div>
                      <div className="text-xs font-semibold uppercase text-slate-400">Captured today</div>
                      <div className="text-xl font-semibold text-ink">18 new intent leads</div>
                    </div>
                    <div className="text-xs font-semibold text-emerald-600">+7 high intent</div>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-5 py-4">
                    <div>
                      <div className="text-xs font-semibold uppercase text-slate-400">Follow-up queue</div>
                      <div className="text-xl font-semibold text-ink">Owner replies ready</div>
                    </div>
                    <div className="text-xs font-semibold text-slate-500">With context</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
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
