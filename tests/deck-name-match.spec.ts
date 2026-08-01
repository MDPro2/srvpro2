import YGOProDeck from 'ygopro-deck-encode';
import { ChallongeService } from '../src/feats';
import {
  getDeckNameExactCandidates,
  getDeckNameRegexCandidates,
} from '../src/legacy-api/utility/deck-name-query';
import { deckNameMatch } from '../src/utility/deck-name-match';

function createLogger() {
  return {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
}

function createDeckbuf() {
  const deck = new YGOProDeck();
  deck.main = Array.from({ length: 40 }, (_, index) => index + 1);
  return Buffer.from(deck.toUpdateDeckPayload()).toString('base64');
}

describe('deckNameMatch', () => {
  test.each([
    ['想成为龍ww的小狗+00000001.ydk', '想成为龍ww的小狗'],
    ['想成为龍ww的小狗+00000001.ydk', '00000001'],
    ['00000002+Kuonji Alice.ydk.ydk', 'Kuonji Alice'],
    ['时の雨＋00000003.ydk', '时の雨'],
    ['Kuonji Alice 2+00000004.ydk', 'Kuonji Alice 2'],
    ['Cafe\u0301+00000005.ydk', 'Café'],
    ['Team+A+00000006.ydk', 'Team+A+00000006'],
  ])('matches %s to %s', (deckName, playerName) => {
    expect(deckNameMatch(deckName, playerName)).toBe(true);
  });

  test.each([
    ['Team+A+00000006.ydk', 'Team'],
    ['Team+A＋00000006.ydk', 'A'],
    ['A B.ydk', 'A'],
    ['A B+00000007.ydk', 'B'],
    ['+00000008.ydk', '00000008'],
    ['Alice+00000009.ydk.ydk.ydk', 'Alice'],
    ['想成为龙ww的小狗+00000001.ydk', '想成为龍ww的小狗'],
  ])('does not partially match %s to %s', (deckName, playerName) => {
    expect(deckNameMatch(deckName, playerName)).toBe(false);
  });
});

describe('deck name database candidates', () => {
  test('includes NFC and NFD exact and plus-side candidates', () => {
    const exact = getDeckNameExactCandidates('Café');
    const regex = getDeckNameRegexCandidates('Café').map(
      (candidate) => new RegExp(candidate),
    );

    expect(exact).toEqual(
      expect.arrayContaining([
        'Café',
        'Café.ydk',
        'Cafe\u0301',
        'Cafe\u0301.ydk.ydk',
      ]),
    );
    expect(regex.some((candidate) => candidate.test('Café+00000001.ydk'))).toBe(
      true,
    );
    expect(
      regex.some((candidate) => candidate.test('00000001＋Cafe\u0301.ydk')),
    ).toBe(true);
    expect(regex.some((candidate) => candidate.test('Café Other.ydk'))).toBe(
      false,
    );
  });
});

describe('Challonge and tournament deck matching', () => {
  const service = new ChallongeService({ createLogger } as any) as any;
  const deckbuf = createDeckbuf();

  test('finds Challonge participants by either plus side and NFC form', () => {
    const tournament = {
      participants: [
        {
          participant: {
            id: 1,
            name: '想成为龍ww的小狗+00000001',
            deckbuf,
          },
        },
        {
          participant: {
            id: 2,
            name: '00000002＋Cafe\u0301',
            deckbuf,
          },
        },
      ],
    };

    expect(
      service.findParticipantByName(tournament, '想成为龍ww的小狗').id,
    ).toBe(1);
    expect(service.findParticipantByName(tournament, '00000001').id).toBe(1);
    expect(service.findParticipantByName(tournament, 'Café').id).toBe(2);
  });

  test('loads the room deck for valid plus matches but not multi-plus prefixes', () => {
    const room = {
      playingPlayers: [
        {
          name: '时の雨＋00000003',
          challongeInfo: {
            name: '时の雨＋00000003',
            deckbuf,
          },
        },
        {
          name: 'Team+A+00000004',
          challongeInfo: {
            name: 'Team+A+00000004',
            deckbuf,
          },
        },
      ],
    };

    expect(service.findExpectedDeckFromRoom(room, '时の雨')?.main).toHaveLength(
      40,
    );
    expect(service.findExpectedDeckFromRoom(room, 'Team')).toBeUndefined();
    expect(
      service.findExpectedDeckFromRoom(room, 'Team+A+00000004')?.main,
    ).toHaveLength(40);
  });
});
