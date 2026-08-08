// This file is part of Quorum, adapted from midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React, { useCallback, useEffect, useState } from 'react';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  Backdrop,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  IconButton,
  Skeleton,
  Typography,
} from '@mui/material';
import CopyIcon from '@mui/icons-material/ContentPasteOutlined';
import StopIcon from '@mui/icons-material/HighlightOffOutlined';
import ThumbUpIcon from '@mui/icons-material/ThumbUpOutlined';
import ThumbDownIcon from '@mui/icons-material/ThumbDownOutlined';
import LockIcon from '@mui/icons-material/Lock';
import { type Observable } from 'rxjs';
import { type QuorumDerivedState, type DeployedQuorumAPI } from '../../../api/src/index';
import { PollState } from '../../../contract/src/index';
import { useDeployedPollContext } from '../hooks';
import { type PollDeployment } from '../contexts';
import { EmptyPollContent } from './Poll.EmptyCardContent';
import { PrivacyPanel } from './PrivacyPanel';
import { TextPromptDialog } from './TextPromptDialog';

/** The props required by the {@link Poll} component. */
export interface PollProps {
  /** The observable poll deployment. */
  pollDeployment$?: Observable<PollDeployment>;
  /** Whether a wallet is connected; every circuit call needs one. */
  isWalletConnected: boolean;
}

/**
 * The UI for a deployed Quorum poll: the question, the public tally, and the
 * vote actions the underlying Compact contract permits.
 *
 * @remarks
 * With no `pollDeployment$`, this renders the deploy/join view instead. The
 * privacy behaviour lives in {@link PrivacyPanel}; what matters here is that
 * `hasVoted` gates the vote buttons using a value derived locally from the
 * secret key, and that a rejected second vote surfaces the circuit's own
 * assertion — raised during proof generation, before any transaction exists.
 */
export const Poll: React.FC<Readonly<PollProps>> = ({ pollDeployment$, isWalletConnected }) => {
  const pollApiProvider = useDeployedPollContext();
  const [pollDeployment, setPollDeployment] = useState<PollDeployment>();
  const [deployedPollAPI, setDeployedPollAPI] = useState<DeployedQuorumAPI>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [pollState, setPollState] = useState<QuorumDerivedState>();
  const [isWorking, setIsWorking] = useState(!!pollDeployment$);
  const [questionPromptOpen, setQuestionPromptOpen] = useState(false);

  const onCreatePoll = useCallback(() => pollApiProvider.resolve(), [pollApiProvider]);
  const onJoinPoll = useCallback(
    (contractAddress: ContractAddress) => pollApiProvider.resolve(contractAddress),
    [pollApiProvider],
  );

  // Every circuit call follows the same shape: flip the working flag, await the
  // call, and surface whatever the contract refused to do. Assertion failures
  // arrive here as ordinary rejections.
  const runCircuit = useCallback(async (call: () => Promise<void>): Promise<void> => {
    setErrorMessage(undefined);
    try {
      setIsWorking(true);
      await call();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWorking(false);
    }
  }, []);

  const onOpenPoll = useCallback(
    async (question: string) => {
      if (!deployedPollAPI || !question.trim()) return;
      await runCircuit(() => deployedPollAPI.open(question));
    },
    [deployedPollAPI, runCircuit],
  );

  const onVote = useCallback(
    async (choice: boolean) => {
      if (!deployedPollAPI) return;
      await runCircuit(() => deployedPollAPI.vote(choice));
    },
    [deployedPollAPI, runCircuit],
  );

  const onClosePoll = useCallback(async () => {
    if (!deployedPollAPI) return;
    await runCircuit(() => deployedPollAPI.close());
  }, [deployedPollAPI, runCircuit]);

  const onResetPoll = useCallback(async () => {
    if (!deployedPollAPI) return;
    await runCircuit(() => deployedPollAPI.reset());
  }, [deployedPollAPI, runCircuit]);

  const onCopyContractAddress = useCallback(async () => {
    if (deployedPollAPI) {
      await navigator.clipboard.writeText(deployedPollAPI.deployedContractAddress);
    }
  }, [deployedPollAPI]);

  useEffect(() => {
    if (!pollDeployment$) return;
    const subscription = pollDeployment$.subscribe(setPollDeployment);
    return () => {
      subscription.unsubscribe();
    };
  }, [pollDeployment$]);

  useEffect(() => {
    if (!pollDeployment || pollDeployment.status === 'in-progress') return;

    setIsWorking(false);

    if (pollDeployment.status === 'failed') {
      setErrorMessage(
        pollDeployment.error.message.length ? pollDeployment.error.message : 'Encountered an unexpected error.',
      );
      return;
    }

    setDeployedPollAPI(pollDeployment.api);
    const subscription = pollDeployment.api.state$.subscribe(setPollState);
    return () => {
      subscription.unsubscribe();
    };
  }, [pollDeployment]);

  const totalVotes = pollState ? pollState.yesVotes + pollState.noVotes : 0n;
  const canVote = !!pollState && pollState.state === PollState.OPEN && !pollState.hasVoted && isWalletConnected;

  return (
    <Card sx={{ position: 'relative', width: 420, minHeight: 300 }} color="primary">
      {!pollDeployment$ && (
        <EmptyPollContent
          onCreatePollCallback={onCreatePoll}
          onJoinPollCallback={onJoinPoll}
          isWalletConnected={isWalletConnected}
        />
      )}

      {pollDeployment$ && (
        <React.Fragment>
          <Backdrop
            sx={{ position: 'absolute', color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
            open={isWorking}
          >
            <Box sx={{ textAlign: 'center' }}>
              <CircularProgress data-testid="poll-working-indicator" />
              <Typography variant="caption" component="div" sx={{ mt: 1 }}>
                proving locally...
              </Typography>
            </Box>
          </Backdrop>
          <Backdrop
            sx={{ position: 'absolute', color: '#ff6b6b', zIndex: (theme) => theme.zIndex.drawer + 1, p: 2 }}
            open={!!errorMessage}
            onClick={() => {
              setErrorMessage(undefined);
            }}
          >
            <Box sx={{ textAlign: 'center' }}>
              <StopIcon fontSize="large" />
              <Typography component="div" variant="body2" data-testid="poll-error-message">
                {errorMessage}
              </Typography>
              <Typography component="div" variant="caption" sx={{ mt: 1, opacity: 0.8 }}>
                tap to dismiss
              </Typography>
            </Box>
          </Backdrop>

          <CardHeader
            avatar={
              pollState ? (
                <PollStateChip state={pollState.state} />
              ) : (
                <Skeleton variant="circular" width={20} height={20} />
              )
            }
            titleTypographyProps={{ color: 'primary', variant: 'body2' }}
            title={toShortFormatContractAddress(deployedPollAPI?.deployedContractAddress) ?? 'Loading...'}
            action={
              deployedPollAPI?.deployedContractAddress ? (
                <IconButton title="Copy contract address" onClick={onCopyContractAddress}>
                  <CopyIcon fontSize="small" />
                </IconButton>
              ) : (
                <Skeleton variant="circular" width={20} height={20} />
              )
            }
          />

          <CardContent sx={{ pt: 0 }}>
            {pollState ? (
              <React.Fragment>
                <Typography data-testid="poll-question" variant="h6" color="primary" sx={{ minHeight: 64 }}>
                  {pollState.question ?? 'No question yet — open the poll to ask one.'}
                </Typography>

                <Tally
                  yesVotes={pollState.yesVotes}
                  noVotes={pollState.noVotes}
                  totalVotes={totalVotes}
                  round={pollState.round}
                />

                <PrivacyPanel state={pollState} />
              </React.Fragment>
            ) : (
              <Skeleton variant="rectangular" width="100%" height={220} />
            )}
          </CardContent>

          <CardActions sx={{ flexWrap: 'wrap', gap: 1, px: 2, pb: 2 }}>
            {pollState && deployedPollAPI ? (
              <React.Fragment>
                {pollState.state === PollState.OPEN && (
                  <React.Fragment>
                    <Button
                      data-testid="poll-vote-yes-btn"
                      variant="contained"
                      startIcon={<ThumbUpIcon />}
                      disabled={!canVote}
                      onClick={() => void onVote(true)}
                    >
                      Yes
                    </Button>
                    <Button
                      data-testid="poll-vote-no-btn"
                      variant="outlined"
                      startIcon={<ThumbDownIcon />}
                      disabled={!canVote}
                      onClick={() => void onVote(false)}
                    >
                      No
                    </Button>
                  </React.Fragment>
                )}

                {pollState.state !== PollState.OPEN && (
                  <Button
                    data-testid="poll-open-btn"
                    variant="contained"
                    disabled={!isWalletConnected}
                    onClick={() => {
                      setQuestionPromptOpen(true);
                    }}
                  >
                    {pollState.state === PollState.DRAFT ? 'Ask a question' : 'Ask a new question'}
                  </Button>
                )}

                {pollState.isOrganizer && pollState.state === PollState.OPEN && (
                  <Button data-testid="poll-close-btn" size="small" onClick={() => void onClosePoll()}>
                    Close poll
                  </Button>
                )}
                {pollState.isOrganizer && pollState.state === PollState.CLOSED && (
                  <Button data-testid="poll-reset-btn" size="small" onClick={() => void onResetPoll()}>
                    New round
                  </Button>
                )}
              </React.Fragment>
            ) : (
              <Skeleton variant="rectangular" width={120} height={30} />
            )}
          </CardActions>

          <TextPromptDialog
            prompt="What should the poll ask?"
            isOpen={questionPromptOpen}
            onCancel={() => {
              setQuestionPromptOpen(false);
            }}
            onSubmit={(text) => {
              setQuestionPromptOpen(false);
              void onOpenPoll(text);
            }}
          />
        </React.Fragment>
      )}
    </Card>
  );
};

/** @internal */
const PollStateChip: React.FC<{ state: PollState }> = ({ state }) => {
  const label = state === PollState.OPEN ? 'open' : state === PollState.CLOSED ? 'closed' : 'draft';
  return (
    <Chip
      data-testid="poll-state-chip"
      size="small"
      label={label}
      icon={state === PollState.CLOSED ? <LockIcon fontSize="small" /> : undefined}
      color={state === PollState.OPEN ? 'success' : 'default'}
    />
  );
};

/** @internal */
const Tally: React.FC<{ yesVotes: bigint; noVotes: bigint; totalVotes: bigint; round: bigint }> = ({
  yesVotes,
  noVotes,
  totalVotes,
  round,
}) => {
  const share = (n: bigint): number => (totalVotes === 0n ? 0 : Number((n * 100n) / totalVotes));

  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography variant="caption" color="primary.dark">
          public tally — round {round.toString()}
        </Typography>
        <Typography variant="caption" color="primary.dark" data-testid="poll-total-votes">
          {totalVotes.toString()} vote{totalVotes === 1n ? '' : 's'}
        </Typography>
      </Box>

      <Box
        sx={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: 'action.disabled', mt: 0.5 }}
      >
        <Box sx={{ width: `${share(yesVotes)}%`, bgcolor: 'success.main' }} />
        <Box sx={{ width: `${share(noVotes)}%`, bgcolor: 'error.main' }} />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="body2" color="primary" data-testid="poll-yes-votes">
          Yes {yesVotes.toString()}
        </Typography>
        <Typography variant="body2" color="primary" data-testid="poll-no-votes">
          No {noVotes.toString()}
        </Typography>
      </Box>
    </Box>
  );
};

/** @internal */
const toShortFormatContractAddress = (contractAddress: ContractAddress | undefined): React.ReactElement | undefined =>
  contractAddress ? (
    <span data-testid="poll-address">
      0x{contractAddress?.replace(/^[A-Fa-f0-9]{6}([A-Fa-f0-9]{8}).*([A-Fa-f0-9]{8})$/g, '$1...$2')}
    </span>
  ) : undefined;
