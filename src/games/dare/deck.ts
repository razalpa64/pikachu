/**
 * Truth or Dare — the deck.
 *
 * Written for two people who already like each other. Three heat levels:
 *   sweet  — safe anywhere, the kind of thing you'd ask on a long drive
 *   flirty — teasing, a bit forward, still fine with the lights on
 *   spicy  — suggestive and private; gated behind an explicit opt-in
 *
 * Nothing here is graphic and nothing assumes anything about either person.
 * Every prompt is skippable, always, with no penalty — that is a rule of the
 * game and not a footnote.
 */

export type Heat = 'sweet' | 'flirty' | 'spicy';
export type Kind = 'truth' | 'dare';

export interface Card {
  kind: Kind;
  heat: Heat;
  text: string;
}

export const HEAT_LABEL: Record<Heat, string> = { sweet: 'Sweet', flirty: 'Flirty', spicy: 'Spicy' };
export const HEAT_BLURB: Record<Heat, string> = {
  sweet: 'Soft questions and silly dares. Safe for anywhere.',
  flirty: 'Teasing, forward, a little bit of trouble.',
  spicy: 'Private, suggestive and only for the two of you.',
};

export const DECK: Card[] = [
  /* ───────────────── sweet · truths ───────────────── */
  { kind: 'truth', heat: 'sweet', text: 'What was the exact moment you realised you liked me?' },
  { kind: 'truth', heat: 'sweet', text: 'What is the smallest thing I do that you find unreasonably endearing?' },
  { kind: 'truth', heat: 'sweet', text: 'Describe our first conversation from your side. What were you actually thinking?' },
  { kind: 'truth', heat: 'sweet', text: 'What is one thing you have never told me because it felt too soppy to say out loud?' },
  { kind: 'truth', heat: 'sweet', text: 'If you could replay one ordinary day with me, which one would you pick?' },
  { kind: 'truth', heat: 'sweet', text: 'What song makes you think of me, and have you ever admitted that?' },
  { kind: 'truth', heat: 'sweet', text: 'What is something you were nervous about telling me that turned out fine?' },
  { kind: 'truth', heat: 'sweet', text: 'Which of my habits did you find odd at first and now secretly like?' },
  { kind: 'truth', heat: 'sweet', text: 'What do you think I would say is your best quality? Then I will tell you if you got it right.' },
  { kind: 'truth', heat: 'sweet', text: 'What is the nicest thing anyone has ever said about us?' },
  { kind: 'truth', heat: 'sweet', text: 'Where do you picture us this time next year?' },
  { kind: 'truth', heat: 'sweet', text: 'What is a tiny tradition you would like us to start?' },
  { kind: 'truth', heat: 'sweet', text: 'What is the last thing I did that made you laugh when you did not want to?' },
  { kind: 'truth', heat: 'sweet', text: 'Which photo of us is your favourite, and why that one?' },

  /* ───────────────── sweet · dares ───────────────── */
  { kind: 'dare', heat: 'sweet', text: 'Send me a voice note right now saying one thing you appreciate about me.' },
  { kind: 'dare', heat: 'sweet', text: 'Give me a compliment you have never given me before. No repeats.' },
  { kind: 'dare', heat: 'sweet', text: 'Do your best impression of me ordering food.' },
  { kind: 'dare', heat: 'sweet', text: 'Draw me from memory in sixty seconds. No looking.' },
  { kind: 'dare', heat: 'sweet', text: 'Pick a song and dance to the chorus. The whole chorus.' },
  { kind: 'dare', heat: 'sweet', text: 'Text one of your friends something nice about me and show me the message.' },
  { kind: 'dare', heat: 'sweet', text: 'Make up a two-line poem about the last meal we shared.' },
  { kind: 'dare', heat: 'sweet', text: 'Hold eye contact with me for thirty seconds without laughing.' },
  { kind: 'dare', heat: 'sweet', text: 'Describe our relationship as a film trailer, in voiceover voice.' },
  { kind: 'dare', heat: 'sweet', text: 'Let me pick your phone wallpaper for the next 24 hours.' },

  /* ───────────────── flirty · truths ───────────────── */
  { kind: 'truth', heat: 'flirty', text: 'What is the first thing you noticed about me physically?' },
  { kind: 'truth', heat: 'flirty', text: 'What do I wear that you like the most, and have you ever said so?' },
  { kind: 'truth', heat: 'flirty', text: 'When was the last time you caught yourself staring at me?' },
  { kind: 'truth', heat: 'flirty', text: 'What is the most attractive thing I do without realising it?' },
  { kind: 'truth', heat: 'flirty', text: 'Have you ever rehearsed something before saying it to me? What was it?' },
  { kind: 'truth', heat: 'flirty', text: 'What is something you want me to do more often?' },
  { kind: 'truth', heat: 'flirty', text: 'Describe the best kiss we have had. Be specific about where and when.' },
  { kind: 'truth', heat: 'flirty', text: 'What is a compliment from me that you still think about?' },
  { kind: 'truth', heat: 'flirty', text: 'What were you hoping would happen on our first date that did not?' },
  { kind: 'truth', heat: 'flirty', text: 'On a scale of one to ten, how distracting am I when you are trying to work? Explain the score.' },
  { kind: 'truth', heat: 'flirty', text: 'What is something small I do that you find genuinely irresistible?' },
  { kind: 'truth', heat: 'flirty', text: 'Have you ever cancelled plans just to spend time with me? Tell the truth.' },

  /* ───────────────── flirty · dares ───────────────── */
  { kind: 'dare', heat: 'flirty', text: 'Whisper something you would normally only text me.' },
  { kind: 'dare', heat: 'flirty', text: 'Give me a sixty-second shoulder rub without saying a word.' },
  { kind: 'dare', heat: 'flirty', text: 'Describe me using only three words, then explain the third one.' },
  { kind: 'dare', heat: 'flirty', text: 'Recreate the face you made the first time I held your hand.' },
  { kind: 'dare', heat: 'flirty', text: 'Send me a message right now that you would be embarrassed for anyone else to read.' },
  { kind: 'dare', heat: 'flirty', text: 'Whoever lost the last round picks a song; you have to slow dance to it.' },
  { kind: 'dare', heat: 'flirty', text: 'Tell me what you were thinking about me five minutes ago. No editing.' },
  { kind: 'dare', heat: 'flirty', text: 'Hold my hand and keep talking normally for the next three rounds.' },
  { kind: 'dare', heat: 'flirty', text: 'Give me a kiss somewhere you have not kissed me today.' },
  { kind: 'dare', heat: 'flirty', text: 'Let me ask one follow-up question to your last answer. You must answer it honestly.' },

  /* ───────────────── spicy · truths ───────────────── */
  { kind: 'truth', heat: 'spicy', text: 'What is something you have wanted to try with me but have not brought up yet?' },
  { kind: 'truth', heat: 'spicy', text: 'What is the most distracting thought you have had about me this week?' },
  { kind: 'truth', heat: 'spicy', text: 'Where is the most unexpected place you have wanted to kiss me?' },
  { kind: 'truth', heat: 'spicy', text: 'What do I do that you find hardest to resist?' },
  { kind: 'truth', heat: 'spicy', text: 'Describe the version of our night you would choose if nothing else was on the schedule.' },
  { kind: 'truth', heat: 'spicy', text: 'What is a fantasy you have about us that you have kept to yourself?' },
  { kind: 'truth', heat: 'spicy', text: 'What is the boldest thing you have ever thought about saying to me?' },
  { kind: 'truth', heat: 'spicy', text: 'When did you most want me to make the first move?' },
  { kind: 'truth', heat: 'spicy', text: 'What is one thing you want more of, and one thing you want slower?' },
  { kind: 'truth', heat: 'spicy', text: 'Which of my outfits should quietly never be worn in public?' },

  /* ───────────────── spicy · dares ───────────────── */
  { kind: 'dare', heat: 'spicy', text: 'Describe, out loud, exactly what you want to happen after this game ends.' },
  { kind: 'dare', heat: 'spicy', text: 'Kiss me for ten seconds. I am counting.' },
  { kind: 'dare', heat: 'spicy', text: 'Tell me one thing you want, in a full sentence, without looking away.' },
  { kind: 'dare', heat: 'spicy', text: 'Put your phone face down. You have my full attention for three minutes — use it.' },
  { kind: 'dare', heat: 'spicy', text: 'Trace a word on my back with one finger. I have to guess it.' },
  { kind: 'dare', heat: 'spicy', text: 'Set the timer for two minutes and do not let go of me until it rings.' },
  { kind: 'dare', heat: 'spicy', text: 'Say the most forward thing you are willing to say tonight. Your call where the line is.' },
  { kind: 'dare', heat: 'spicy', text: 'Pick one thing from your last spicy answer and make it happen before the night is over.' },
];

export const countBy = (heat: Heat, kind: Kind) =>
  DECK.filter((c) => c.heat === heat && c.kind === kind).length;
