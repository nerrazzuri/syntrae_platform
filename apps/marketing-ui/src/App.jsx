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

const pinSignals = [
  {
    label: 'High intent',
    title: '“Does this work for sensitive skin?”',
    meta: 'Skincare · Comment thread',
  },
  {
    label: 'Ready to buy',
    title: '“Where can I order and how fast can it ship?”',
    meta: 'Local service · Inquiry',
  },
  {
    label: 'Comparison',
    title: '“Is this better than the clinic near me?”',
    meta: 'Beauty · Competitive intent',
  },
  {
    label: 'Pricing signal',
    title: '“What’s the package price for couples?”',
    meta: 'Hospitality · Booking',
  },
  {
    label: 'Urgent',
    title: '“Can you deliver to Penang this week?”',
    meta: 'Retail · Fulfillment',
  },
  {
    label: 'Outcome',
    title: '18 intent leads qualified today',
    meta: 'Pipeline update',
  },
];

export default function App() {
  return (
    <div className="bg-mist text-ink">
      <div className="page-hero">
        <header className="page-shell pt-8">
          <nav className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo-mark.svg" alt="SyntraeAI" className="h-10 w-10" />
              <span className="font-display text-lg font-semibold">SyntraeAI</span>
            </div>
            <div className="hidden items-center gap-8 text-xs font-semibold uppercase tracking-[0.2em] text-olive md:flex">
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

        <section className="page-shell pb-16 pt-16 text-center">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6">
            <span className="pill">Real demand, not empty traffic</span>
            <h1 className="font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-[70px]">
              Customer
              <br />
              <span className="text-focusBlue font-semibold">demand</span> already exist.
            </h1>
            <p className="text-xl font-medium leading-relaxed text-olive">
              You’re just not seeing them. SyntraeAI turn those questions into customers.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a className="button-primary" href="/signup">Start Discovering</a>
              <a className="button-secondary" href="#how">How it works</a>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {['No more empty views', 'Find demand earlier', 'Keep conversation context'].map((item) => (
                <span key={item} className="pill-outline">
                  <span className="dot" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section id="problem" className="page-shell section-space">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <span className="section-kicker">The frustration</span>
            <h2 className="section-title">Most marketing spend goes to people who were never looking.</h2>
            <p className="text-base text-olive">
              Ads, content, and promo campaigns are expensive. Even when views rise, the leads rarely do. Meanwhile, real customers are already asking
              questions in social comments — and the opportunity disappears if you miss them.
            </p>
          </div>
          <div className="pin-board">
            {[
              '“Is this suitable for sensitive skin?”',
              '“How much is the package for couples?”',
              '“Can you deliver to Penang?”',
              '“Does it work for acne scars?”',
            ].map((item) => (
              <div key={item} className="pin-card">
                <p className="text-sm text-ink">{item}</p>
                <span className="pin-meta">missed signal</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="why" className="page-shell section-space">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <span className="section-kicker">Why traditional marketing fails</span>
            <h2 className="section-title">Attention is expensive. Intent is already there.</h2>
            <p className="text-base text-olive">
              The best prospects are not convinced by ads — they are already looking for answers. SyntraeAI surfaces that intent, so your team can respond
              while the customer still cares.
            </p>
          </div>
          <div className="pin-board">
            {[
              'Ads are bidding wars. Comments are owned demand.',
              'Content fatigue slows growth. Intent signals stay evergreen.',
              'Views do not equal revenue. Questions do.',
            ].map((item) => (
              <div key={item} className="pin-card">
                <p className="text-sm text-ink">{item}</p>
                <span className="pin-meta">why it matters</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="page-shell section-space">
        <div className="space-y-10">
          <div className="space-y-4">
            <span className="section-kicker">How SyntraeAI works</span>
            <h2 className="section-title">Find, qualify, and act on demand in one flow.</h2>
            <p className="text-base text-olive">SyntraeAI keeps the original comment context so operators can reply fast and build trust.</p>
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
              <div key={item.step} className="pin-card">
                <div className="text-xs font-semibold uppercase tracking-[0.25em] text-warm">{item.step}</div>
                <h3 className="mt-4 text-xl font-semibold text-ink">{item.title}</h3>
                <p className="mt-3 text-sm text-olive">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="differentiators" className="page-shell section-space">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-4">
            <span className="section-kicker">Why SyntraeAI</span>
            <h2 className="section-title">A demand engine, not another dashboard.</h2>
            <p className="text-base text-olive">
              SyntraeAI is designed to help businesses capture live intent. It is a better alternative to buying more ads or chasing trend-driven content.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {differentiators.map((item) => (
              <div key={item.title} className="pin-card">
                <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-sm text-olive">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="page-shell section-space">
        <div className="space-y-10">
          <div className="space-y-4">
            <span className="section-kicker">Who it is for</span>
            <h2 className="section-title">Built for businesses that need real leads, not more noise.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {useCases.map((item) => (
              <div key={item.title} className="pin-card">
                <h3 className="text-lg font-semibold text-ink">{item.title}</h3>
                <p className="mt-3 text-sm text-olive">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="proof" className="page-shell section-space">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            <span className="section-kicker">Credibility</span>
            <h2 className="section-title">Designed for high-intent social workflows.</h2>
            <p className="text-base text-olive">
              SyntraeAI keeps comment context intact, prioritizes urgency, and helps teams respond fast. The platform is optimized for Xiaohongshu/Rednote
              operators today and expanding for broader social channels.
            </p>
          </div>
          <div className="pin-board">
            {[
              'Intent score attached to each comment',
              'Buyer stage and urgency shown up front',
              'No context loss between capture and reply',
            ].map((item) => (
              <div key={item} className="pin-card">
                <p className="text-sm text-ink">{item}</p>
                <span className="pin-meta">signal review</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="page-shell section-space">
        <div className="space-y-8">
          <div className="space-y-4">
            <span className="section-kicker">FAQ</span>
            <h2 className="section-title">Clear answers before you start.</h2>
          </div>
          <div className="grid gap-4">
            {faqs.map((item) => (
              <div key={item.q} className="pin-card">
                <h3 className="text-base font-semibold text-ink">{item.q}</h3>
                <p className="mt-3 text-sm text-olive">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-shell section-space">
        <div className="cta-block">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-warm">Start now</p>
            <h2 className="mt-4 font-display text-3xl font-semibold">Stop chasing attention. Start capturing demand.</h2>
            <p className="mt-3 text-sm text-olive">
              Your next customer is already asking. SyntraeAI helps you show up first.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a className="button-primary" href="/signup">Start Free</a>
            <a className="button-secondary" href="/app">Open Console</a>
          </div>
        </div>
      </section>

      <footer className="page-shell pb-12 pt-6 text-xs text-warm">
        <div className="flex flex-col gap-4 border-t border-sand pt-6 md:flex-row md:items-center md:justify-between">
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
