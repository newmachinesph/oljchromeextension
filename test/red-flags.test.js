import { describe, it, expect } from 'vitest';
import {
  RED_FLAGS,
  findRedFlags,
  describeRedFlags,
  explainRedFlags,
} from '../src/core/red-flags.js';

const ids = (text) => findRedFlags(text).map((flag) => flag.id);

describe('what it catches', () => {
  it('spots a listing that charges you to start', () => {
    expect(ids('There is a one-time placement fee of P500.')).toContain('upfront-payment');
    expect(ids('You will need to pay a deposit for the equipment.')).toContain('upfront-payment');
  });

  it('spots unpaid work dressed as a trial', () => {
    expect(ids('We start with an unpaid trial task.')).toContain('unpaid-trial');
    expect(ids('The trial period is unpaid.')).toContain('unpaid-trial');
  });

  it('spots unpaid training', () => {
    expect(ids('Two weeks of unpaid training, then full salary.')).toContain('unpaid-training');
  });

  it('spots commission-only work advertised with a big number', () => {
    expect(ids('Earn up to $3,000/mo - commission only!')).toContain('commission-only');
    expect(ids('This role is commission based with no base pay.')).toContain('commission-only');
  });

  it('spots being offered exposure instead of money', () => {
    expect(ids('Great for the exposure and your portfolio.')).toContain('exposure');
  });

  it('spots being moved off the platform before hiring', () => {
    expect(ids('Message me on Telegram to apply.')).toContain('off-platform');
    expect(ids('Contact us directly on WhatsApp for details.')).toContain('off-platform');
  });
});

describe('what it deliberately leaves alone', () => {
  /**
   * A false positive tells someone a real job is a scam, which is its own kind
   * of harm. Each pattern has to match a phrase, not a worrying-sounding word.
   */
  it('does not flag ordinary commission on top of a salary', () => {
    expect(ids('$1,200/month base plus commission on every sale.')).not.toContain(
      'commission-only',
    );
    expect(ids('Bonuses and commission are paid quarterly.')).toHaveLength(0);
  });

  it('does not flag paid training', () => {
    expect(ids('Two weeks of paid training before you start.')).toHaveLength(0);
  });

  it('does not flag a job that merely mentions fees it pays', () => {
    expect(ids('We cover your transaction fee for every payout.')).toHaveLength(0);
  });

  it('does not flag a trial that is paid', () => {
    expect(ids('We begin with a paid trial week at the full rate.')).toHaveLength(0);
  });

  it('does not flag a role that happens to involve Telegram', () => {
    // Managing a client's Telegram channel is a job, not a warning sign.
    expect(ids('You will manage our Telegram channel and post daily updates.')).toHaveLength(0);
  });

  it('says nothing about an ordinary listing', () => {
    expect(findRedFlags('Virtual assistant, $900/month, 40 hrs/week.')).toHaveLength(0);
  });

  it('copes with nothing at all', () => {
    expect(findRedFlags(null)).toHaveLength(0);
    expect(findRedFlags('')).toHaveLength(0);
  });
});

describe('ordering and wording', () => {
  it('leads with the most serious flag', () => {
    // Paying to work is worse than being paid on commission, and the chip only
    // has room for the first one or two.
    const flags = findRedFlags('Commission only, and there is a registration fee.');
    expect(flags[0].id).toBe('upfront-payment');
  });

  it('reads as a short chip', () => {
    const words = describeRedFlags(findRedFlags('Unpaid trial, commission only.'));
    expect(words).toBe('unpaid trial · commission only');
  });

  it('explains itself in full for a tooltip', () => {
    const words = explainRedFlags(findRedFlags('There is a placement fee.'));
    expect(words).toContain('asks for money');
    expect(words).toContain('never charges you');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeRedFlags([])).toBe('');
    expect(explainRedFlags(null)).toBe('');
  });

  it('gives every flag a label and a reason', () => {
    for (const flag of RED_FLAGS) {
      expect(flag.label.length).toBeGreaterThan(3);
      expect(flag.why.length).toBeGreaterThan(20);
    }
  });
});
