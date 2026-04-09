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
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(230,0,35,0.12),transparent_45%),radial-gradient(circle_at_bottom_right,rgba(229,229,224,0.9),transparent_55%)]" />
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-sand/70 blur-3xl" />
        <div className="absolute -right-24 top-24 h-80 w-80 rounded-full bg-[hsla(60,20%,98%,0.8)] blur-3xl" />

        <header className="relative mx-auto flex w-full max-w-[1280px] items-center justify-between px-6 pb-10 pt-8 sm:px-10 lg:px-12">
          <div className="flex items-center gap-3">
            <img src="/logo-mark.svg" alt="SyntraeAI" className="h-10 w-10" />
            <span className="font-display text-lg font-semibold">SyntraeAI</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-olive md:flex">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="transition hover:text-ink">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a className="button-secondary" href="/app">Open Console</a>
            <a className="button-primary" href="/signup">Start Free</a>
          </div>
        </header>

        <HeroSection />
      </div>

      <section id="problem" className="mx-auto w-full max-w-[1280px] px-6 py-20 sm:px-10 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <span className="section-kicker">The frustration</span>
            <h2 className="section-title">Most marketing spend goes to people who were never looking.</h2>
            <p className="text-base text-olive">
              Ads, content, and promo campaigns are expensive. Even when views rise, the leads rarely do. Meanwhile, real customers are already asking
              questions in social comments — and the opportunity disappears if you miss them.
            </p>
          </div>
          <div className="rounded-[28px] border border-sand bg-white p-6">
            <h3 className="text-lg font-semibold text-ink">Common signals brands miss</h3>
            <div className="mt-5 grid gap-3 text-sm text-olive">
              {[
                '“Is this suitable for sensitive skin?”',
                '“How much is the package for couples?”',
                '“Can you deliver to Penang?”',
                '“Does it work for acne scars?”',
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-sand bg-[hsla(60,20%,98%,0.5)] px-4 py-3">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="why" className="mx-auto w-full max-w-[1280px] px-6 py-20 sm:px-10 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <span className="section-kicker">Why traditional marketing fails</span>
            <h2 className="section-title">Attention is expensive. Intent is already there.</h2>
            <p className="text-base text-olive">
              The best prospects are not convinced by ads — they are already looking for answers. SyntraeAI surfaces that intent, so your team can respond
              while the customer still cares.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              'Ads are bidding wars. Comments are owned demand.',
              'Content fatigue slows growth. Intent signals stay evergreen.',
              'Views do not equal revenue. Questions do.',
            ].map((item) => (
              <div key={item} className="card-surface flex min-h-[140px] items-center p-5 text-sm font-semibold text-olive">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto w-full max-w-[1280px] px-6 py-20 sm:px-10 lg:px-12">
        <div className="flex flex-col gap-10">
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
              <div key={item.step} className="card-surface flex h-full flex-col p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-warm">{item.step}</div>
                <h3 className="mt-4 text-xl font-semibold text-ink">{item.title}</h3>
                <p className="mt-3 text-sm text-olive">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="differentiators" className="mx-auto w-full max-w-[1280px] px-6 py-20 sm:px-10 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-4">
            <span className="section-kicker">Why SyntraeAI</span>
            <h2 className="section-title">A demand engine, not another dashboard.</h2>
            <p className="text-base text-olive">
              SyntraeAI is designed to help businesses capture live intent. It is a better alternative to buying more ads or chasing trend-driven content.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {differentiators.map((item) => (
              <div key={item.title} className="rounded-[24px] border border-sand bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
                <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-sm text-olive">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="mx-auto w-full max-w-[1280px] px-6 py-20 sm:px-10 lg:px-12">
        <div className="space-y-10">
          <div className="space-y-4">
            <span className="section-kicker">Who it is for</span>
            <h2 className="section-title">Built for businesses that need real leads, not more noise.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {useCases.map((item) => (
              <div key={item.title} className="card-surface p-6">
                <h3 className="text-lg font-semibold text-ink">{item.title}</h3>
                <p className="mt-3 text-sm text-olive">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="proof" className="mx-auto w-full max-w-[1280px] px-6 py-20 sm:px-10 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            <span className="section-kicker">Credibility</span>
            <h2 className="section-title">Designed for high-intent social workflows.</h2>
            <p className="text-base text-olive">
              SyntraeAI keeps comment context intact, prioritizes urgency, and helps teams respond fast. The platform is optimized for Xiaohongshu/Rednote
              operators today and expanding for broader social channels.
            </p>
          </div>
          <div className="glass-panel p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-warm">Signal review</div>
            <div className="mt-5 space-y-4">
              {[
                'Intent score attached to each comment',
                'Buyer stage and urgency shown up front',
                'No context loss between capture and reply',
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm text-olive">
                  <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto w-full max-w-[1280px] px-6 py-20 sm:px-10 lg:px-12">
        <div className="space-y-8">
          <div className="space-y-4">
            <span className="section-kicker">FAQ</span>
            <h2 className="section-title">Clear answers before you start.</h2>
          </div>
          <div className="grid gap-4">
            {faqs.map((item) => (
              <div key={item.q} className="card-surface p-6">
                <h3 className="text-base font-semibold text-ink">{item.q}</h3>
                <p className="mt-3 text-sm text-olive">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1280px] px-6 py-20 sm:px-10 lg:px-12">
        <div className="relative overflow-hidden rounded-[32px] border border-sand bg-ink px-8 py-12 text-white shadow-glow">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />
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

      <footer className="mx-auto w-full max-w-[1280px] px-6 pb-12 pt-6 text-sm text-warm sm:px-10 lg:px-12">
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

export function HeroSection() {
  return (
    <section className="relative mx-auto w-full max-w-[1280px] px-6 pb-24 pt-10 sm:px-10 lg:px-12 lg:pb-28 lg:pt-16">
      <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-8">
          <div className="inline-flex items-center rounded-[16px] border border-sand bg-[hsla(60,20%,98%,0.5)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-olive">
            Real demand, not empty traffic
          </div>

          <div className="space-y-5">
            <h1 className="font-display text-5xl font-semibold tracking-tight text-ink sm:text-6xl lg:text-7xl lg:leading-[0.96]">
              The best customers are already asking.
            </h1>
            <p className="max-w-2xl text-xl font-medium leading-relaxed text-olive lg:text-2xl">
              Most businesses never see them. SyntraeAI helps you find and act on them first.
            </p>
          </div>

          <p className="max-w-xl text-base leading-8 text-olive lg:text-lg">
            Customers are already asking questions in comments, threads, and social conversations.
            Instead of chasing cold traffic, SyntraeAI helps you respond to real demand while it is still fresh.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <a className="button-primary" href="/signup">Find customers already asking</a>
            <a className="button-secondary" href="#how">See how it works</a>
          </div>

          <p className="text-sm text-warm">
            Built for operators who want qualified leads, not vanity views.
          </p>

          <div className="flex flex-wrap gap-3">
            {[
              'No more empty views',
              'Find demand earlier',
              'Keep conversation context',
            ].map((item) => (
              <div
                key={item}
                className="inline-flex items-center gap-2 rounded-[16px] border border-sand bg-white px-4 py-2 text-sm font-medium text-olive"
              >
                <span className="h-2 w-2 rounded-full bg-accent" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[36px] border border-sand bg-white p-6 shadow-soft">
          <div className="flex items-center justify-between border-b border-sand pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warm">
                Intent signal board
              </p>
              <p className="mt-2 text-sm text-olive">
                Live questions with buying intent, captured before they go cold.
              </p>
            </div>
            <span className="rounded-[12px] bg-[hsla(60,20%,98%,0.8)] px-3 py-1 text-xs font-semibold text-olive">
              Live
            </span>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
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

          <div className="mt-6 grid gap-4 md:grid-cols-2">
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
    <div className="rounded-[20px] border border-sand bg-[hsla(60,20%,98%,0.5)] p-5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          {label}
        </p>
      </div>
      <p className="mt-4 text-base font-semibold leading-7 text-ink">{title}</p>
      <p className="mt-2 text-sm text-warm">{meta}</p>
      <p className="mt-4 text-sm leading-6 text-olive">{note}</p>
    </div>
  );
}

function OutcomeCard({
  eyebrow,
  title,
  aside,
}) {
  return (
    <div className="rounded-[20px] border border-sand bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-warm">
            {eyebrow}
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">{title}</p>
        </div>
        <span className="text-sm font-semibold text-accent">{aside}</span>
      </div>
    </div>
  );
}
