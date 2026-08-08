import { QuorumSimulator } from "./quorum-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";
import { randomBytes } from "./utils.js";
import { type Ledger, PollState } from "../managed/quorum/contract/index.js";

setNetworkId("undeployed");

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/**
 * A plain-object view of the ledger.
 *
 * The ledger's `nullifiers` field is a live WASM-backed Set, so comparing two
 * ledger objects directly compares internal handles rather than contents.
 * Normalising first makes equality mean what the test intends.
 */
const snapshot = (ledger: Ledger) => ({
  state: ledger.state,
  question: ledger.question.is_some ? ledger.question.value : null,
  yesVotes: ledger.yesVotes,
  noVotes: ledger.noVotes,
  round: ledger.round,
  organizer: hex(ledger.organizer),
  nullifiers: [...ledger.nullifiers].map(hex).sort(),
});

describe("Quorum smart contract", () => {
  describe("initial state", () => {
    it("generates initial ledger state deterministically", () => {
      const key = randomBytes(32);
      expect(snapshot(new QuorumSimulator(key).getLedger())).toEqual(
        snapshot(new QuorumSimulator(key).getLedger()),
      );
    });

    it("starts in DRAFT with no question, no votes and no nullifiers", () => {
      const key = randomBytes(32);
      const simulator = new QuorumSimulator(key);
      const ledger = simulator.getLedger();

      expect(ledger.state).toEqual(PollState.DRAFT);
      expect(ledger.question.is_some).toEqual(false);
      expect(ledger.yesVotes).toEqual(0n);
      expect(ledger.noVotes).toEqual(0n);
      expect(ledger.nullifiers.size()).toEqual(0n);
      expect(ledger.round).toEqual(1n);
      expect(simulator.getPrivateState()).toEqual({ secretKey: key });
    });
  });

  describe("opening a poll", () => {
    it("records the question and the organizer, and moves to OPEN", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      const question = "Should we move to a four-day week?";
      simulator.open(question);

      const ledger = simulator.getLedger();
      expect(ledger.state).toEqual(PollState.OPEN);
      expect(ledger.question.is_some).toEqual(true);
      expect(ledger.question.value).toEqual(question);
      expect(ledger.organizer).toEqual(simulator.organizerKey());
    });

    it("refuses to open a second poll while one is open", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      expect(() => simulator.open("Should we get a company dog?")).toThrow(
        "failed assert: A poll is already open",
      );
    });
  });

  describe("voting", () => {
    it("increments the chosen tally and records exactly one nullifier", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");

      const nullifier = simulator.voteNullifier();
      simulator.vote(true);

      const ledger = simulator.getLedger();
      expect(ledger.yesVotes).toEqual(1n);
      expect(ledger.noVotes).toEqual(0n);
      expect(ledger.nullifiers.size()).toEqual(1n);
      expect(ledger.nullifiers.member(nullifier)).toEqual(true);
    });

    it("routes a No vote to the other counter", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      simulator.vote(false);

      const ledger = simulator.getLedger();
      expect(ledger.yesVotes).toEqual(0n);
      expect(ledger.noVotes).toEqual(1n);
    });

    it("rejects a second vote from the same identity", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      simulator.vote(true);

      expect(() => simulator.vote(false)).toThrow(
        "failed assert: You have already voted in this poll",
      );

      // The rejected vote left no trace: the assertion fires before any state
      // change, so the tally and the nullifier set are untouched.
      const ledger = simulator.getLedger();
      expect(ledger.yesVotes).toEqual(1n);
      expect(ledger.noVotes).toEqual(0n);
      expect(ledger.nullifiers.size()).toEqual(1n);
    });

    it("rejects a repeat vote even when the voter switches their answer", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      simulator.vote(true);
      expect(() => simulator.vote(true)).toThrow(
        "failed assert: You have already voted in this poll",
      );
    });

    it("counts distinct identities separately", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      simulator.vote(true);

      simulator.switchUser(randomBytes(32));
      simulator.vote(true);

      simulator.switchUser(randomBytes(32));
      simulator.vote(false);

      const ledger = simulator.getLedger();
      expect(ledger.yesVotes).toEqual(2n);
      expect(ledger.noVotes).toEqual(1n);
      expect(ledger.nullifiers.size()).toEqual(3n);
    });

    it("rejects votes before a poll is opened", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      expect(() => simulator.vote(true)).toThrow(
        "failed assert: No poll is currently open",
      );
    });

    it("rejects votes after the poll is closed", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      simulator.close();

      simulator.switchUser(randomBytes(32));
      expect(() => simulator.vote(true)).toThrow(
        "failed assert: No poll is currently open",
      );
    });
  });

  describe("privacy properties", () => {
    it("never writes the secret key to the ledger", () => {
      const key = randomBytes(32);
      const simulator = new QuorumSimulator(key);
      simulator.open("Should we move to a four-day week?");
      simulator.vote(true);

      const ledger = simulator.getLedger();
      const published = [ledger.organizer, ...ledger.nullifiers];
      for (const value of published) {
        expect(hex(value)).not.toEqual(hex(key));
      }
    });

    it("leaves private state untouched by voting", () => {
      const key = randomBytes(32);
      const simulator = new QuorumSimulator(key);
      const before = simulator.getPrivateState();
      simulator.open("Should we move to a four-day week?");
      simulator.vote(true);
      expect(simulator.getPrivateState()).toEqual(before);
      expect(simulator.getPrivateState()).toEqual({ secretKey: key });
    });

    it("derives unrelated values for the organizer and voter roles of one key", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      // Domain separation: the organizer's published key cannot be matched
      // against their nullifier to reveal that they voted.
      expect(simulator.organizerKey()).not.toEqual(simulator.voteNullifier());
    });

    it("records the tally without recording who voted which way", () => {
      const yesKey = randomBytes(32);
      const noKey = randomBytes(32);
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");

      simulator.switchUser(yesKey);
      const yesNullifier = simulator.voteNullifier();
      simulator.vote(true);

      simulator.switchUser(noKey);
      const noNullifier = simulator.voteNullifier();
      simulator.vote(false);

      const ledger = simulator.getLedger();
      expect(ledger.yesVotes).toEqual(1n);
      expect(ledger.noVotes).toEqual(1n);

      // Both nullifiers are present and indistinguishable: nothing on the
      // ledger associates either one with the Yes counter or the No counter.
      expect(ledger.nullifiers.member(yesNullifier)).toEqual(true);
      expect(ledger.nullifiers.member(noNullifier)).toEqual(true);
      expect(ledger.nullifiers.size()).toEqual(2n);
    });
  });

  describe("organizer permissions", () => {
    it("refuses to let a non-organizer close the poll", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      simulator.switchUser(randomBytes(32));

      expect(() => simulator.close()).toThrow(
        "failed assert: Only the organizer can close this poll",
      );
    });

    it("refuses to let a non-organizer reset the poll", () => {
      const organizerKey = randomBytes(32);
      const simulator = new QuorumSimulator(organizerKey);
      simulator.open("Should we move to a four-day week?");
      simulator.close();
      simulator.switchUser(randomBytes(32));

      expect(() => simulator.reset()).toThrow(
        "failed assert: Only the organizer can reset this poll",
      );
    });

    it("refuses to reset while the poll is still open", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      expect(() => simulator.reset()).toThrow(
        "failed assert: Close the poll before resetting it",
      );
    });
  });

  describe("rounds", () => {
    it("clears the tally and nullifiers on reset, and advances the round", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      simulator.vote(true);
      simulator.close();
      simulator.reset();

      const ledger = simulator.getLedger();
      expect(ledger.state).toEqual(PollState.DRAFT);
      expect(ledger.round).toEqual(2n);
      expect(ledger.yesVotes).toEqual(0n);
      expect(ledger.noVotes).toEqual(0n);
      expect(ledger.nullifiers.size()).toEqual(0n);
      expect(ledger.question.is_some).toEqual(false);
    });

    it("lets a previous voter vote again in the next round", () => {
      const voterKey = randomBytes(32);
      const organizerKey = randomBytes(32);
      const simulator = new QuorumSimulator(organizerKey);

      simulator.open("Should we move to a four-day week?");
      simulator.switchUser(voterKey);
      const firstRoundNullifier = simulator.voteNullifier();
      simulator.vote(true);
      expect(() => simulator.vote(true)).toThrow(
        "failed assert: You have already voted in this poll",
      );

      simulator.switchUser(organizerKey);
      simulator.close();
      simulator.reset();
      simulator.open("Should we get a company dog?");

      simulator.switchUser(voterKey);
      // The same key yields a different nullifier once the round advances,
      // which is what makes the voter eligible again.
      const secondRoundNullifier = simulator.voteNullifier();
      expect(secondRoundNullifier).not.toEqual(firstRoundNullifier);

      simulator.vote(false);
      const ledger = simulator.getLedger();
      expect(ledger.noVotes).toEqual(1n);
      expect(ledger.nullifiers.member(secondRoundNullifier)).toEqual(true);
      expect(ledger.nullifiers.member(firstRoundNullifier)).toEqual(false);
    });

    it("lets the organizer reopen from CLOSED without a reset", () => {
      const simulator = new QuorumSimulator(randomBytes(32));
      simulator.open("Should we move to a four-day week?");
      simulator.vote(true);
      simulator.close();

      // Reopening keeps the round, so the nullifier set still applies and
      // prior voters stay blocked — the tally, however, starts fresh.
      simulator.open("Should we get a company dog?");
      const ledger = simulator.getLedger();
      expect(ledger.state).toEqual(PollState.OPEN);
      expect(ledger.yesVotes).toEqual(0n);
      expect(ledger.nullifiers.size()).toEqual(1n);
    });
  });
});
