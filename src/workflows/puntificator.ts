import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

export type PuntificatorParams = {};

export class PuntificatorWorkflow extends WorkflowEntrypoint<Env, PuntificatorParams> {
	async run(event: WorkflowEvent<PuntificatorParams>, step: WorkflowStep) {
		const trendingPuns = await step.do('retrieve-trending-puns', async () => {
			const resultsJSON = await this.env.LEADERBOARD.get('trending');
			if (resultsJSON === undefined || resultsJSON === null) {
				throw new NonRetryableError(`Currently trending puns leaderboard not found`);
			}
			return JSON.parse(resultsJSON);
		});

		const createdPun = await step.do('create-new-pun-based-on-trends', async () => {
			const punsOnly = trendingPuns.map((p: { pun: string }) => `<trending-pun>${p.pun}</trending-pun>`);
			const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
				prompt: `You are a pun maker.

				Below are trending puns.

				You should attempt to understand why they are popular, and you then build a new pun that is similar in style conceptually.

				Use the trending puns for your inspiration, but create original puns.

				If your pun has a punchline, ensure to put in two newlines between the intro and the punchline (like the examples)

				${punsOnly.join('\n\n')}

				Return only the pun. Do not include an intro or explanation, only a single pun. Do not include the surrounding XML, only return a single pun.
				Return only one pun, please, not multiple.
				`,
			});
            // @ts-ignore   
			return result.response;
		});
		const rating = await step.do('judge-pun', async () => {
            // @ts-ignore
			const result = await this.env.AI.run('@hf/nousresearch/hermes-2-pro-mistral-7b', {
				messages: [
					{
						role: 'system',
						content: `You are a pun critic.

				The user is going to submit a pun for you to judge.

				You're goal is to make sure that you are as honest as possible about the pun.

				Use the tools provided to you.
				`,
					},
					{ role: 'user', content: createdPun },
				],
				tools: [
					{
						name: 'ratePun',
						description: 'Rates a pun and provides feedback',
						parameters: {
							type: 'object',
							properties: {
								rating: {
									type: 'number',
									description: 'The rating of the pun between 1 and 10. 1 being the worst, 10 being the most funny.',
								},
								explanation: {
									type: 'string',
									description: 'An explanation of why the pun works.'
								},
								feedback: {
									type: 'string',
									description: 'Feedback about how to improve the pun',
								},
							},
							required: ['rating'],
						},
					},
				],
			}, {
				gateway: {
					id: "punderful"
				}
			});
            // @ts-ignore
			if (result.tool_calls === undefined) {
				// This will cause a retry
				throw new Error('tool_calls not found');
			}
            // @ts-ignore
			const toolCall = result.tool_calls[0];
            if (toolCall === undefined) {
                console.warn("Result", result);
                throw new Error("The first tool call was not found");
            }
            if (toolCall.arguments === undefined) {
                console.warn("Tool Call was found but no arguments?", toolCall);
                throw new Error("Tool call was completed with no arguments.");
            }
			if (toolCall.arguments.rating === undefined || toolCall.arguments.rating < 8) {
				throw new NonRetryableError(
					`Rating was ${toolCall.arguments.rating} for ${createdPun} with feedback: ${toolCall.arguments.feedback}`
				);
			}
			return toolCall.arguments;
		});
		const punId = await step.do('save-pun', async () => {
			const results = await this.env.DB.prepare(`INSERT INTO puns (id, pun, status, creator) VALUES (?, ?, ?, ?) RETURNING id;`)
				.bind(crypto.randomUUID(), createdPun, 'draft', 'puntificator')
				.run();
			return results.results[0].id as string;
		});
		const publishWorkflowId = await step.do('publish', async () => {
			const id = `puntificator-${crypto.randomUUID()}`;
            console.log({id});
			const workflow = await this.env.PUBLISH.create({
                id,
                params: {
                    punId,
                    pun: createdPun,
                }
			});
			return id;
		});
		await step.sleep('wait-for-publish', '30 seconds');
		await step.do('ensure-published', async () => {
			console.log(`Looking for workflow with id ${publishWorkflowId}`);
			const workflow = await this.env.PUBLISH.get(publishWorkflowId);
			console.log('Now checking status');
			const state = await workflow.status();
			if (state.status !== 'complete') {
				throw new NonRetryableError(`Publish Workflow ${publishWorkflowId} was in the state of ${state.status}`);
			}
			return state.status;
		});
		await step.sleep('wait-to-see-feedback', '1 day');
		const results = await step.do('check-feedback', async () => {
			const likeResults = await this.env.DB.prepare(
				`SELECT count(*) as counter FROM pun_interactions WHERE pun_id=? AND interaction_type=?`
			)
				.bind(punId, 'like')
				.first() as {counter: number};
			if (likeResults === null) {
				return;
			}
			return {
				likes: likeResults.counter,
			};
		});
    }
}
