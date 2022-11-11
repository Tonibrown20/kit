const param_pattern = /^(\[)?(\.\.\.)?(\w+)(?:=(\w+))?(\])?$/;

/** @param {string} id */
export function parse_route_id(id) {
	/** @type {string[]} */
	const names = [];

	/** @type {string[]} */
	const types = [];

	/** @type {boolean[]} */
	const optional = [];

	// `/foo` should get an optional trailing slash, `/foo.json` should not
	// const add_trailing_slash = !/\.[a-z]+$/.test(key);
	let add_trailing_slash = true;

	const pattern =
		id === '/'
			? /^\/$/
			: new RegExp(
					`^${get_route_segments(id)
						.map((segment, i, segments) => {
							if (segment.includes('%')) {
								throw new Error(`Routes ${id} must be provided in decoded form.`);
							}
							if (/[#\/\?]/.test(segment)) {
								// #, ?, and / will not be decoded by decodeURI so cannot be matched
								// '/' is illegal on all file systems so we don't bother warning about it
								throw new Error(
									`Route ${id} should not contain '#' or '?'. Please use a parameter.`
								);
							}
							// special case — /[...rest]/ could contain zero segments
							const rest_match = /^\[\.\.\.(\w+)(?:=(\w+))?\]$/.exec(segment);
							if (rest_match) {
								names.push(rest_match[1]);
								types.push(rest_match[2]);
								optional.push(false);
								return '(?:/(.*))?';
							}
							// special case — /[[optional]]/ could contain zero segments
							const optional_match = /^\[\[(\w+)(?:=(\w+))?\]\]$/.exec(segment);
							if (optional_match) {
								names.push(optional_match[1]);
								types.push(optional_match[2]);
								optional.push(true);
								return '(?:/([^/]+))?';
							}

							const is_last = i === segments.length - 1;

							if (!segment) {
								return;
							}

							const parts = segment.split(/\[(.+?)\](?!\])/);
							const result = parts
								.map((content, i) => {
									if (i % 2) {
										const match = param_pattern.exec(content);
										if (!match) {
											throw new Error(
												`Invalid param: ${content}. Params and matcher names can only have underscores and alphanumeric characters.`
											);
										}

										const [, is_optional, is_rest, name, type] = match;
										// It's assumed that the following invalid route id cases are already checked
										// - unbalanced brackets
										// - optional param following rest param

										names.push(name);
										types.push(type);
										optional.push(!!is_optional);
										return is_rest ? '(.*?)' : is_optional ? '([^/]*)?' : '([^/]+?)';
									}

									if (is_last && content.includes('.')) add_trailing_slash = false;

									return (
										content // allow users to specify characters on the file system in an encoded manner
											.normalize()
											// escape characters that have special meaning in regex
											.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
									);
								})
								.join('');

							return '/' + result;
						})
						.join('')}${add_trailing_slash ? '/?' : ''}$`
			  );

	return { pattern, names, types, optional };
}

/**
 * Returns `false` for `(group)` segments
 * @param {string} segment
 */
function affects_path(segment) {
	return !/^\([^)]+\)$/.test(segment);
}

/**
 * Splits a route id into its segments, removing segments that
 * don't affect the path (i.e. groups). The root route is represented by `/`
 * and will be returned as `['']`.
 * @param {string} route
 * @returns string[]
 */
export function get_route_segments(route) {
	return route.slice(1).split('/').filter(affects_path);
}

/**
 * @param {RegExpMatchArray} match
 * @param {{
 *   names: string[];
 *   types: string[];
 *   optional: boolean[];
 * }} candidate
 * @param {Record<string, import('types').ParamMatcher>} matchers
 */
export function exec(match, { names, types, optional }, matchers) {
	/** @type {Record<string, string>} */
	const params = {};

	for (let i = 0; i < names.length; i += 1) {
		const name = names[i];
		const type = types[i];
		let value = match[i + 1];

		if (value || !optional[i]) {
			if (type) {
				const matcher = matchers[type];
				if (!matcher) throw new Error(`Missing "${type}" param matcher`); // TODO do this ahead of time?

				if (!matcher(value)) return;
			}

			params[name] = value ?? '';
		}
	}

	return params;
}
