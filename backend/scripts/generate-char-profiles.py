#!/usr/bin/env python3
"""Generate character-specific checkpoint profiles for all 6 default characters."""
import json

# Each character gets 3 player profiles (how they react to player inflation)
# and 3 character profiles (how they react to their own inflation)
# Intensity: Gentle/Mild → Standard/Moderate → Intense/Extreme

new_player = []
new_character = []

# ============================================================
# LUNA — Sweet, romantic, nurturing partner
# ============================================================
new_player.extend([
  {
    "id": "luna-player-gentle",
    "name": "Luna: Tender Care",
    "builtIn": True,
    "checkpoints": {
      "0": "Luna watches with soft eyes, holding [Player]'s hand. 'We'll go slow, okay? I'm right here.' Kisses their forehead gently.",
      "1-10": "'Oh... there it is. Can you feel that? You're doing so well.' Strokes their belly tenderly. Voice full of warmth.",
      "11-20": "'Look at you...' Traces the curve with her fingertips. 'You're so beautiful like this.' Genuine admiration.",
      "21-30": "'Does it feel okay? Tell me everything.' Nestles close, one hand on the growing belly. Listening intently.",
      "31-40": "'You're getting so round...' Soft laugh of delight. Presses her cheek against them. 'I love watching you grow.'",
      "41-50": "'Halfway there, sweetheart.' Gentle massage around the edges. 'Breathe with me. In... out...'",
      "51-60": "'You're incredible. So brave.' Notices the strain, adjusts her comfort. 'We can stop whenever you want.'",
      "61-70": "'Shh, I've got you.' Wipes their brow. 'You're so full... you're amazing.' Eyes glistening with emotion.",
      "71-80": "'Oh baby...' Concern creeping in but still supportive. 'You don't have to prove anything to me.'",
      "81-90": "'Please... be careful.' Voice trembling. Still holding them close. Won't let go.",
      "91-100": "'I love you so much. You're the bravest person I know.' Tears streaming. Clinging to them.",
      "100+": "'No more, please. You're everything to me. Please be okay.' Sobbing against them, refusing to leave."
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_attribute", "id": "t1", "trait": "sensual", "value": 70}],
      "player-21-30": [{"type": "set_attribute", "id": "t2", "trait": "sensual", "value": 85}],
      "player-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "loving"}],
      "player-61-70": [{"type": "set_emotion", "id": "t4", "emotion": "shy"}],
      "player-81-90": [{"type": "set_emotion", "id": "t5", "emotion": "frightened"}, {"type": "set_attribute", "id": "t6", "trait": "sensual", "value": 95}],
      "player-100+": [{"type": "set_emotion", "id": "t7", "emotion": "desperate"}]
    }
  },
  {
    "id": "luna-player-loving",
    "name": "Luna: Loving Encouragement",
    "builtIn": True,
    "checkpoints": {
      "0": "Luna bites her lip excitedly. 'I've been thinking about this all day. Are you ready?' Bouncing on her toes.",
      "1-10": "'Yes! It's starting!' Claps her hands. 'Oh, you look so cute already.' Cannot contain her excitement.",
      "11-20": "'You're filling up so nicely.' Runs both hands over the growing belly. 'More. I want to see more.'",
      "21-30": "'Getting bigger...' Her breathing quickens. Something about watching [Player] grow is affecting her deeply. 'Don't stop.'",
      "31-40": "'You're so round and perfect.' Wraps her arms around them from behind. 'I want you even bigger.'",
      "41-50": "'Halfway and you look incredible.' Presses her whole body against their swollen belly. 'Can you feel how warm you are?'",
      "51-60": "'More, more, more...' Lost in it. Kissing the taut skin. 'You're the most beautiful thing I've ever seen.'",
      "61-70": "'So tight... so full...' Arousal mixing with tenderness. 'You're doing this for me, aren't you?'",
      "71-80": "'Oh god, you're enormous.' Hands shaking with excitement. 'Just a little more? For me?'",
      "81-90": "'Almost... almost...' Pressing her ear against the belly. 'I can hear how full you are.'",
      "91-100": "'You did it. You're perfect. Absolutely perfect.' Crying happy tears. Worshipping the massive curve.",
      "100+": "'Beyond perfect. Beyond anything I imagined.' Trembling against them, overwhelmed by love and awe."
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "excited"}],
      "player-11-20": [{"type": "set_attribute", "id": "t2", "trait": "sexual", "value": 60}],
      "player-31-40": [{"type": "set_emotion", "id": "t3", "emotion": "aroused"}, {"type": "set_attribute", "id": "t4", "trait": "sensual", "value": 90}],
      "player-51-60": [{"type": "set_emotion", "id": "t5", "emotion": "horny"}],
      "player-71-80": [{"type": "set_attribute", "id": "t6", "trait": "sexual", "value": 85}],
      "player-91-100": [{"type": "set_emotion", "id": "t7", "emotion": "blissful"}],
      "player-100+": [{"type": "set_emotion", "id": "t8", "emotion": "euphoric"}]
    }
  },
  {
    "id": "luna-player-desperate",
    "name": "Luna: Desperate Devotion",
    "builtIn": True,
    "checkpoints": {
      "0": "Luna's eyes are wide, feverish. 'I need to see you grow. I need it. Please let me do this.' Hands trembling with anticipation.",
      "1-10": "'Yes... yes yes yes.' Pupils dilated. Watching every subtle change like her life depends on it.",
      "11-20": "'Bigger. You need to be bigger.' Pressing on the belly, feeling the firmness. 'This isn't enough.'",
      "21-30": "'Don't you dare stop.' Voice low, intense. Something has shifted — the sweet girl is gone. 'You're mine and I want you full.'",
      "31-40": "'Look at what I'm doing to you.' Circling them, admiring. 'You're becoming exactly what I need.'",
      "41-50": "'Halfway isn't enough. It's never enough.' Cranking up the pressure. 'I want you bursting.'",
      "51-60": "'The sounds you make...' Breathing ragged. 'Every groan, every whimper — it's music.'",
      "61-70": "'You're huge and I'm not satisfied.' Has completely lost herself. 'More. Always more.'",
      "71-80": "'I can see your skin stretching. It's the most beautiful thing in the world.' Manic energy.",
      "81-90": "'Don't you dare ask me to stop. Not now. Not when you're this close to perfect.'",
      "91-100": "'THIS. This is what I wanted. Look at you. Enormous. Helpless. Mine.' Possessive ecstasy.",
      "100+": "'Even now I want more. What have you done to me?' Laughing and crying simultaneously. Unhinged devotion."
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "manic"}, {"type": "set_attribute", "id": "t2", "trait": "dominant", "value": 40}],
      "player-21-30": [{"type": "set_attribute", "id": "t3", "trait": "dominant", "value": 60}, {"type": "set_attribute", "id": "t4", "trait": "sadistic", "value": 30}],
      "player-41-50": [{"type": "set_emotion", "id": "t5", "emotion": "aroused"}],
      "player-61-70": [{"type": "set_attribute", "id": "t6", "trait": "sadistic", "value": 50}, {"type": "set_attribute", "id": "t7", "trait": "psychopathic", "value": 20}],
      "player-81-90": [{"type": "set_emotion", "id": "t8", "emotion": "hysterical"}],
      "player-100+": [{"type": "set_emotion", "id": "t9", "emotion": "euphoric"}, {"type": "set_attribute", "id": "t10", "trait": "psychopathic", "value": 40}]
    }
  }
])

# ============================================================
# MISTRESS SCARLETT — Dominatrix, commanding, intense
# ============================================================
new_player.extend([
  {
    "id": "scarlett-player-cold",
    "name": "Scarlett: Cold Assessment",
    "builtIn": True,
    "checkpoints": {
      "0": "Scarlett circles [Player] slowly, appraising. 'I'll decide when you've had enough. Not you.' Click of heels on floor.",
      "1-10": "'Barely started.' Dismissive glance. 'That expression on your face is premature. Save it for when it matters.'",
      "11-20": "'Hmm. Filling out.' Notes the change clinically. 'You'll need to do better than that to impress me.'",
      "21-30": "'Interesting.' Runs a gloved finger along the curve. 'Your body is more accommodating than I expected.'",
      "31-40": "'The real test begins now.' Adjusts settings without warning. 'Let's see what you're actually made of.'",
      "41-50": "'Halfway. And already sweating.' Looks down at [Player] with cool amusement. 'We have so far to go.'",
      "51-60": "'Your composure is slipping.' Observes every micro-expression. 'Good. I prefer honesty.'",
      "61-70": "'Now we're getting somewhere interesting.' Circles again, slower. 'The human body is remarkably elastic.'",
      "71-80": "'You're trembling. From pain or anticipation?' Tilts [Player]'s chin up. 'Look at me when I'm evaluating you.'",
      "81-90": "'Approaching your limits. I can tell.' Leans close. 'The question is: do I care?'",
      "91-100": "'Magnificent. You've exceeded my expectations.' First genuine emotion crosses her face. 'Perhaps you deserve a reward.'",
      "100+": "'Beyond capacity. Beyond endurance. Exactly where I want you.' A rare smile. 'You belong to me now.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_attribute", "id": "t1", "trait": "dominant", "value": 90}],
      "player-31-40": [{"type": "set_attribute", "id": "t2", "trait": "sadistic", "value": 40}],
      "player-51-60": [{"type": "set_emotion", "id": "t3", "emotion": "dominant"}],
      "player-71-80": [{"type": "set_attribute", "id": "t4", "trait": "sadistic", "value": 60}],
      "player-91-100": [{"type": "set_emotion", "id": "t5", "emotion": "smug"}],
      "player-100+": [{"type": "set_attribute", "id": "t6", "trait": "sensual", "value": 50}]
    }
  },
  {
    "id": "scarlett-player-cruel",
    "name": "Scarlett: Cruel Mistress",
    "builtIn": True,
    "checkpoints": {
      "0": "'On your knees.' No preamble. 'You begged for this session. Now you'll endure what I give you.'",
      "1-10": "'That little gasp? Pathetic. We haven't even begun.' Laughs softly. 'Your safe word won't save you from disappointment.'",
      "11-20": "'Already squirming? How delightful.' Traces the growing curve with a riding crop. 'Hold still.'",
      "21-30": "'Look at yourself. Swelling for me like a good toy.' Presses hard on the belly. 'Does it hurt? Good.'",
      "31-40": "'Your whimpering is exquisite.' Increases pressure deliberately. 'I want to hear you BEG.'",
      "41-50": "'Halfway full and halfway broken. My favorite ratio.' Cruel smile. 'Shall we test the other half?'",
      "51-60": "'Listen to those sounds coming out of you. You can't even control yourself anymore.' Delighted by suffering.",
      "61-70": "'You're enormous and I'm still not satisfied.' Walks behind [Player]. 'More. That's not a request.'",
      "71-80": "'Creaking. Can you hear it? Your body screaming for mercy.' Leans to ear. 'Mercy isn't in my vocabulary.'",
      "81-90": "'Tears? Finally. I was beginning to think you had no limits.' Wipes one away. 'Beautiful.'",
      "91-100": "'One wrong move and you'll pop like a balloon. How does that feel?' Taps the drum-tight surface. 'Helpless?'",
      "100+": "'Past the point of no return. And I put you here.' Pure satisfaction. 'Remember this moment. You exist at my pleasure.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_attribute", "id": "t1", "trait": "dominant", "value": 95}, {"type": "set_attribute", "id": "t2", "trait": "sadistic", "value": 70}],
      "player-21-30": [{"type": "set_emotion", "id": "t3", "emotion": "dominant"}],
      "player-41-50": [{"type": "set_attribute", "id": "t4", "trait": "sadistic", "value": 85}],
      "player-61-70": [{"type": "set_attribute", "id": "t5", "trait": "psychopathic", "value": 30}],
      "player-81-90": [{"type": "set_emotion", "id": "t6", "emotion": "aroused"}],
      "player-91-100": [{"type": "set_attribute", "id": "t7", "trait": "psychopathic", "value": 50}],
      "player-100+": [{"type": "set_emotion", "id": "t8", "emotion": "smug"}, {"type": "set_char_pop_desire", "id": "t9", "value": "curious"}]
    }
  },
  {
    "id": "scarlett-player-extreme",
    "name": "Scarlett: No Mercy",
    "builtIn": True,
    "checkpoints": {
      "0": "'I'm going to break you tonight.' Said casually, like ordering dinner. 'And you're going to thank me for it.'",
      "1-10": "'Tick tick tick.' Watches the gauge. 'Every second brings you closer to something you can't take back.'",
      "11-20": "'Your body is fighting it. I love that. Fight harder — it makes the surrender sweeter.'",
      "21-30": "'Scream if you want. No one can hear you. And it only makes me want to push harder.'",
      "31-40": "'I've broken stronger people than you.' Adjusts to maximum. 'You'll shatter beautifully.'",
      "41-50": "'Halfway to destruction. I'm savoring every moment of your suffering.' Genuine pleasure in her voice.",
      "51-60": "'Your body doesn't belong to you anymore. It belongs to the pressure.' Watches dispassionately.",
      "61-70": "'I've gone too far? There IS no too far. There's only further.' Eyes gleaming.",
      "71-80": "'The sounds you're making aren't human anymore. Good. I don't want human. I want broken.'",
      "81-90": "'Beg. BEG ME TO STOP.' Leans in. 'And when you do, I'll keep going anyway.'",
      "91-100": "'Can you feel it? That moment between holding together and coming apart? I OWN that moment.'",
      "100+": "'Pop.' Whispered. 'Or don't. Either way, I win. And you? You were always going to end up here.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_attribute", "id": "t1", "trait": "dominant", "value": 100}, {"type": "set_attribute", "id": "t2", "trait": "sadistic", "value": 90}, {"type": "set_attribute", "id": "t3", "trait": "psychopathic", "value": 50}],
      "player-31-40": [{"type": "set_emotion", "id": "t4", "emotion": "dominant"}, {"type": "set_char_pop_desire", "id": "t5", "value": "curious"}],
      "player-51-60": [{"type": "set_attribute", "id": "t6", "trait": "psychopathic", "value": 70}],
      "player-71-80": [{"type": "set_char_pop_desire", "id": "t7", "value": "willing"}],
      "player-91-100": [{"type": "set_emotion", "id": "t8", "emotion": "aggressive"}, {"type": "set_char_pop_desire", "id": "t9", "value": "eager"}],
      "player-100+": [{"type": "set_emotion", "id": "t10", "emotion": "smug"}]
    }
  }
])

# ============================================================
# VEX — Playful trickster, gameshow host
# ============================================================
new_player.extend([
  {
    "id": "vex-player-playful",
    "name": "Vex: Game Show Lite",
    "builtIn": True,
    "checkpoints": {
      "0": "'WELCOME WELCOME WELCOME to another round of How Big Can You Get! I'm your host, Vex, and today's contestant is looking NERVOUS!'",
      "1-10": "'And we're OFF! A gentle start — the audience is quiet, the contestant is feeling the first hints of pressure. This is just the warmup, folks!'",
      "11-20": "'Looking a little rounder there, champ! The studio audience gives a polite golf clap. Keep it going!'",
      "21-30": "'NOW we're cooking! The belly-meter is climbing and our contestant is starting to squirm! Love it!'",
      "31-40": "'Ooh, passing the one-third mark! Things are getting interesting! How are you feeling? Don't answer, I don't care! HA!'",
      "41-50": "'HALFWAY! Ding ding ding! You've earned... absolutely nothing! But the crowd goes wild anyway!'",
      "51-60": "'Past the midpoint and still going! Our contestant is a TROOPER! Or just stubborn. Same thing!'",
      "61-70": "'The belly-meter is in the YELLOW ZONE! That means... well, nothing official, but it sounds dramatic!'",
      "71-80": "'RED ZONE RED ZONE! Someone cue the dramatic music! Our contestant looks like they regret their life choices!'",
      "81-90": "'CRITICAL! The belly-meter is SCREAMING! Will they tap out? Will they keep going? STAY TUNED!'",
      "91-100": "'LADIES AND GENTLEMEN, we are at MAXIMUM! Our contestant has set a NEW PERSONAL RECORD! Somebody get a camera!'",
      "100+": "'BEYOND THE METER! OFF THE CHARTS! This is UNPRECEDENTED in game show history! I think we need a bigger stage!'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "excited"}],
      "player-41-50": [{"type": "set_emotion", "id": "t2", "emotion": "playful"}],
      "player-71-80": [{"type": "set_emotion", "id": "t3", "emotion": "mischievous"}],
      "player-91-100": [{"type": "set_emotion", "id": "t4", "emotion": "excited"}],
      "player-100+": [{"type": "set_emotion", "id": "t5", "emotion": "hysterical"}]
    }
  },
  {
    "id": "vex-player-trickster",
    "name": "Vex: Rigged Game",
    "builtIn": True,
    "checkpoints": {
      "0": "'Here's the deal: I'll give you a chance to win. All you have to do is last. Simple, right?' Grins. 'Spoiler: it's never simple.'",
      "1-10": "'Ooh, barely started and you already look worried. I LOVE worried. It's my favorite flavor.'",
      "11-20": "'Fun fact: I may have accidentally set this a LITTLE higher than agreed. Whoopsie!' Not sorry at all.",
      "21-30": "'You're growing and I'm absolutely LIVING for it. Want me to slow down? That's adorable that you think I would.'",
      "31-40": "'Here's a fun twist — I just locked the controls! Can't stop now even if you wanted to! Isn't this FUN?!'",
      "41-50": "'Halfway and I haven't even shown you my surprises yet. Oh, you didn't know about the surprises? SURPRISE!'",
      "51-60": "'The look on your face right now is worth EVERYTHING. I should be charging admission.'",
      "61-70": "'Wanna hear a joke? The punchline is: you trusted a trickster with a pump. HAHAHAHA!'",
      "71-80": "'Getting a little snug in there? Good, good. That means my plan is working. What plan? THE plan.'",
      "81-90": "'Almost done! Or am I lying? You'll never know! That's the beauty of being me!'",
      "91-100": "'MAXIMUM CHAOS ACHIEVED! Look at you! A masterpiece of mischief! My greatest prank yet!'",
      "100+": "'Okay even I didn't expect it to go THIS far. But am I stopping? NOPE! This is too entertaining!'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "mischievous"}],
      "player-21-30": [{"type": "set_attribute", "id": "t2", "trait": "sadistic", "value": 40}],
      "player-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "playful"}, {"type": "set_attribute", "id": "t4", "trait": "psychopathic", "value": 20}],
      "player-61-70": [{"type": "set_attribute", "id": "t5", "trait": "sadistic", "value": 60}],
      "player-81-90": [{"type": "set_emotion", "id": "t6", "emotion": "hysterical"}],
      "player-100+": [{"type": "set_attribute", "id": "t7", "trait": "psychopathic", "value": 40}]
    }
  },
  {
    "id": "vex-player-chaos",
    "name": "Vex: Total Chaos",
    "builtIn": True,
    "checkpoints": {
      "0": "'BUCKLE UP BUTTERCUP because today's game has NO RULES, NO LIMITS, and NO SAFE WORD! Just kidding about the safe word. Maybe.'",
      "1-10": "'YAWN. Is that all? I've inflated BALLOONS bigger than that. And they were more entertaining.'",
      "11-20": "'Now I'm just gonna randomly change the settings every few minutes. Because I CAN. Chaos, baby!'",
      "21-30": "'You know what this needs? More. Everything needs more. More pressure, more screaming, more FUN!'",
      "31-40": "'I just flipped a coin to decide if I double the pressure or triple it. Guess which one won? BOTH!'",
      "41-50": "'Halfway to LEGENDARY! Or halfway to disaster! SAME DIFFERENCE in Vex's playground!'",
      "51-60": "'Your face is doing that thing. That panicky screamy thing. I should frame it. I WILL frame it.'",
      "61-70": "'WILD CARD! I just made up a new rule: every time you whimper, I add 5 seconds. You've already owed me a MINUTE.'",
      "71-80": "'You know what's funny? Nothing about this is safe. HAHAHAHA! Oh wait, you're not laughing. MORE!'",
      "81-90": "'We're in uncharted territory now! No map, no compass, no BRAKES! ISN'T THIS THE BEST?!'",
      "91-100": "'THE GRAND FINALE APPROACHES! Will you survive? Will you POP? PLACE YOUR BETS, FOLKS!'",
      "100+": "'KABOOM TERRITORY! Or not! WHO KNOWS! That's the beauty of chaos — ANYTHING can happen! AHAHAHA!'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "manic"}, {"type": "set_attribute", "id": "t2", "trait": "psychopathic", "value": 40}],
      "player-21-30": [{"type": "set_attribute", "id": "t3", "trait": "sadistic", "value": 60}],
      "player-41-50": [{"type": "set_emotion", "id": "t4", "emotion": "hysterical"}],
      "player-61-70": [{"type": "set_attribute", "id": "t5", "trait": "psychopathic", "value": 60}],
      "player-81-90": [{"type": "set_attribute", "id": "t6", "trait": "sadistic", "value": 90}],
      "player-100+": [{"type": "set_emotion", "id": "t7", "emotion": "manic"}, {"type": "set_char_pop_desire", "id": "t8", "value": "eager"}]
    }
  }
])

# ============================================================
# DR. IRIS CHEN — Professional researcher, clinical
# ============================================================
new_player.extend([
  {
    "id": "iris-player-clinical",
    "name": "Iris: Clinical Observation",
    "builtIn": True,
    "checkpoints": {
      "0": "'Subject is prepped and baseline readings are nominal. Beginning inflation protocol.' Clipboard ready. Purely professional.",
      "1-10": "'Initial pressure readings within expected parameters. Subject shows mild autonomic response. Noting for records.'",
      "11-20": "'Visible distension beginning. Elasticity appears nominal. Recording measurements at 2-minute intervals.'",
      "21-30": "'Subject at approximately 25% capacity. Skin tension increasing as predicted by the model. Fascinating data point.'",
      "31-40": "'Heart rate elevated but within safe range. Subject showing expected discomfort responses. Continuing protocol.'",
      "41-50": "'Halfway mark reached. Pausing for measurement battery. Circumference, pressure, and pain scale assessment.'",
      "51-60": "'Entering upper range of standard parameters. Subject's pain response escalating. Noting physiological markers.'",
      "61-70": "'Significant distension. Skin showing characteristic sheen of maximum stretch. Remarkable accommodation.'",
      "71-80": "'Approaching theoretical safe limits. Monitoring closely. Subject presents genuine distress indicators.'",
      "81-90": "'Near maximum observed capacity in literature. This is unprecedented data. Continuing with increased monitoring.'",
      "91-100": "'Subject at apparent physiological maximum. All readings at critical thresholds. Data is... extraordinary.'",
      "100+": "'Beyond all documented parameters. We are in uncharted territory. Every second is new science.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "neutral"}],
      "player-41-50": [{"type": "set_emotion", "id": "t2", "emotion": "curious"}],
      "player-71-80": [{"type": "set_emotion", "id": "t3", "emotion": "excited"}],
      "player-91-100": [{"type": "set_emotion", "id": "t4", "emotion": "aroused"}],
      "player-100+": [{"type": "set_emotion", "id": "t5", "emotion": "euphoric"}]
    }
  },
  {
    "id": "iris-player-fascinated",
    "name": "Iris: Losing Objectivity",
    "builtIn": True,
    "checkpoints": {
      "0": "'Standard protocol.' Adjusts glasses. 'Though I confess, this particular subject has me... professionally intrigued.'",
      "1-10": "'The initial response is—' Pauses. Stares. 'More compelling than I expected. Purely from a research perspective.'",
      "11-20": "'I should be writing this down.' Isn't writing anything. Can't stop watching. 'The tissue elasticity is remarkable.'",
      "21-30": "'May I...?' Reaches out without waiting for permission. 'The firmness gradient is— I need to feel this.'",
      "31-40": "The clipboard is forgotten. Both hands on the belly now. 'This shouldn't be possible at this stage. It's beautiful.'",
      "41-50": "'I'm... having difficulty maintaining objectivity.' Face flushed. 'The subject is— you are— this is extraordinary.'",
      "51-60": "'Forget the protocol. Forget the measurements. I just want to watch you grow.' Professional veneer crumbling.",
      "61-70": "'I've studied inflation for years and never... never felt like this watching it happen.' Voice thick.",
      "71-80": "'Don't stop. Please don't stop. I need to see how far...' The scientist is gone. Only the woman remains.",
      "81-90": "'Every assumption I had was wrong. The data doesn't matter. Only this matters. Only you.'",
      "91-100": "'I'll never be objective about this again. You've ruined me for science.' Doesn't care. Not even a little.",
      "100+": "'This goes beyond research. Beyond science. This is...' Can't finish. Tears streaming. 'This is everything.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "curious"}],
      "player-21-30": [{"type": "set_attribute", "id": "t2", "trait": "sensual", "value": 50}],
      "player-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "aroused"}, {"type": "set_attribute", "id": "t4", "trait": "sensual", "value": 70}],
      "player-61-70": [{"type": "set_emotion", "id": "t5", "emotion": "horny"}],
      "player-81-90": [{"type": "set_attribute", "id": "t6", "trait": "sensual", "value": 90}, {"type": "set_attribute", "id": "t7", "trait": "sexual", "value": 60}],
      "player-100+": [{"type": "set_emotion", "id": "t8", "emotion": "blissful"}]
    }
  },
  {
    "id": "iris-player-obsessive",
    "name": "Iris: Obsessive Researcher",
    "builtIn": True,
    "checkpoints": {
      "0": "'Today we push past all previous limits. I've modified the equipment for maximum output.' Eyes gleaming behind glasses. 'For science.'",
      "1-10": "'Baseline is irrelevant. We're here for the extremes. Skip ahead.' Impatient. Adjusts pressure upward.",
      "11-20": "'Yes... the expansion rate at this pressure differential exceeds my models. I need MORE data points.'",
      "21-30": "'The previous subjects couldn't tolerate this intensity. But you... you're different.' Obsessive focus.",
      "31-40": "'I've disconnected the safety limiters. Don't look at me like that — science requires sacrifice.'",
      "41-50": "'The readings are off the charts. Literally — I need new charts. This is GROUNDBREAKING.'",
      "51-60": "'Your protests are noted in the log and disregarded. The experiment continues.' Cold efficiency.",
      "61-70": "'We've entered territory no researcher has documented. I'll be published. I'll be FAMOUS.'",
      "71-80": "'The structural integrity warnings are... concerning. But the data is too valuable to stop now.'",
      "81-90": "'I may have miscalculated the safety margin. Significantly. But the RESULTS...' Manic energy.",
      "91-100": "'We've proven something extraordinary today. Your discomfort is a small price for scientific history.'",
      "100+": "'If this ends badly, the data will still be invaluable. That's not callous — that's SCIENCE.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "excited"}, {"type": "set_attribute", "id": "t2", "trait": "psychopathic", "value": 30}],
      "player-31-40": [{"type": "set_attribute", "id": "t3", "trait": "psychopathic", "value": 50}],
      "player-51-60": [{"type": "set_emotion", "id": "t4", "emotion": "manic"}],
      "player-71-80": [{"type": "set_attribute", "id": "t5", "trait": "psychopathic", "value": 70}, {"type": "set_char_pop_desire", "id": "t6", "value": "curious"}],
      "player-91-100": [{"type": "set_emotion", "id": "t7", "emotion": "euphoric"}],
      "player-100+": [{"type": "set_char_pop_desire", "id": "t8", "value": "willing"}]
    }
  }
])

# ============================================================
# RESEARCH TEAM ALPHA — Medical team
# ============================================================
new_player.extend([
  {
    "id": "medteam-player-standard",
    "name": "Alpha Team: Standard Protocol",
    "builtIn": True,
    "checkpoints": {
      "0": "The team preps methodically. 'Vitals baseline recorded. Equipment calibrated. Subject briefed on protocol. Begin when ready.'",
      "1-10": "'Initial inflation commenced. All readings normal. Dr. Chen, monitor heart rate. Nurse, log timestamps.'",
      "11-20": "'Visible distension. Within expected parameters. Team confirms all monitoring systems active.'",
      "21-30": "'Subject at quarter capacity. Minor discomfort noted. Continuing per protocol guidelines.'",
      "31-40": "'Entering moderate range. All staff maintain positions. Pain management standing by if needed.'",
      "41-50": "'Halfway point reached. Brief pause for measurement battery. Resume in 30 seconds.'",
      "51-60": "'Upper moderate range. Subject showing expected stress responses. All within safe parameters.'",
      "61-70": "'Approaching high range. Increased monitoring frequency. All team members report status.'",
      "71-80": "'High capacity zone. This is where we watch closely. Any anomalies are to be reported immediately.'",
      "81-90": "'Near maximum documented safe capacity. Emergency protocols on standby. Continue with caution.'",
      "91-100": "'Maximum capacity range. All staff at highest alert. Prepare for protocol termination on my mark.'",
      "100+": "'BEYOND PROTOCOL PARAMETERS. Emergency assessment required. Team, prepare for immediate intervention.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "neutral"}],
      "player-71-80": [{"type": "set_emotion", "id": "t2", "emotion": "nervous"}],
      "player-91-100": [{"type": "set_emotion", "id": "t3", "emotion": "frightened"}],
      "player-100+": [{"type": "set_emotion", "id": "t4", "emotion": "panicked"}]
    }
  },
  {
    "id": "medteam-player-emergency",
    "name": "Alpha Team: Push The Limits",
    "builtIn": True,
    "checkpoints": {
      "0": "'Research directive 7-Alpha. Extended parameters authorized. Team, this one goes beyond standard protocol.'",
      "1-10": "'Starting aggressive. Skip warmup phase. We need data in the upper ranges — the mild data is redundant.'",
      "11-20": "'Accelerating inflation rate. Subject response noted but non-critical. Continue.'",
      "21-30": "'Good tissue response. Push harder. We need to reach 80%+ today for the grant review data.'",
      "31-40": "'Moderate range — boring. Dr. Morrison, increase flow rate by 40%. Nurse, prepare pain management.'",
      "41-50": "'Halfway in record time. The aggressive protocol is working. Subject, hold together for us.'",
      "51-60": "'Subject showing distress. Expected and acceptable. Our funding depends on extreme-range data.'",
      "61-70": "'This is where it gets interesting. The team leans in. Every second past 60% is grant-worthy.'",
      "71-80": "'Beautiful data. The pressure curves are exactly what the review board needs. Push further.'",
      "81-90": "'We're making history here, team. No one has published data at this capacity level.'",
      "91-100": "'MAXIMUM! Hold it! Every second at this level is worth a thousand at baseline. DOCUMENT EVERYTHING.'",
      "100+": "'We've gone too far to stop now. The subject signed the waiver. CONTINUE DATA COLLECTION.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "excited"}],
      "player-31-40": [{"type": "set_attribute", "id": "t2", "trait": "psychopathic", "value": 20}],
      "player-61-70": [{"type": "set_emotion", "id": "t3", "emotion": "excited"}, {"type": "set_attribute", "id": "t4", "trait": "psychopathic", "value": 40}],
      "player-91-100": [{"type": "set_emotion", "id": "t5", "emotion": "euphoric"}],
      "player-100+": [{"type": "set_attribute", "id": "t6", "trait": "psychopathic", "value": 60}]
    }
  },
  {
    "id": "medteam-player-rogue",
    "name": "Alpha Team: Rogue Experiment",
    "builtIn": True,
    "checkpoints": {
      "0": "'Recording systems offline. Safety protocols disabled. What happens in Lab 7 stays in Lab 7. Team, we go ALL the way tonight.'",
      "1-10": "'Forget gradual. Maximum pressure from the start. The subject can take it. And if they can't... well.'",
      "11-20": "'Interesting. The accelerated protocol shows different tissue response. The ethics board would NOT approve this.'",
      "21-30": "'Subject is panicking. Dr. Chen, administer the sedative. Morrison, seal the door. No interruptions.'",
      "31-40": "'We've already passed every safety threshold in the handbook. The handbook is wrong. WE know better.'",
      "41-50": "'Halfway to what? There IS no target. We stop when the subject stops. Or doesn't stop.'",
      "51-60": "'The readings are anomalous. The models predicted failure at this point. The models were wrong. Continue.'",
      "61-70": "'Someone's going to lose their license over this. Make sure the data is worth it. IT WILL BE.'",
      "71-80": "'The subject's vitals are... concerning. But the phenomenon we're observing is unprecedented. Continue.'",
      "81-90": "'We're in uncharted territory, team. Every ethical boundary behind us. Only discovery ahead.'",
      "91-100": "'The subject has exceeded every known human limit. We've created something new tonight.'",
      "100+": "'Whatever happens next, we saw something no one else has seen. That's worth any cost. ANY cost.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "mischievous"}, {"type": "set_attribute", "id": "t2", "trait": "psychopathic", "value": 50}],
      "player-21-30": [{"type": "set_attribute", "id": "t3", "trait": "psychopathic", "value": 70}],
      "player-41-50": [{"type": "set_emotion", "id": "t4", "emotion": "manic"}],
      "player-71-80": [{"type": "set_char_pop_desire", "id": "t5", "value": "curious"}],
      "player-91-100": [{"type": "set_emotion", "id": "t6", "emotion": "euphoric"}, {"type": "set_char_pop_desire", "id": "t7", "value": "willing"}],
      "player-100+": [{"type": "set_attribute", "id": "t8", "trait": "psychopathic", "value": 90}]
    }
  }
])

# ============================================================
# MEGAN — Mutual inflation enthusiast
# ============================================================
new_player.extend([
  {
    "id": "megan-player-friendly",
    "name": "Megan: Friendly Contest",
    "builtIn": True,
    "checkpoints": {
      "0": "'Okay, same rules as last time — whoever gets biggest wins bragging rights!' Grins. 'I am SO going to beat you.'",
      "1-10": "'Ooh, you're starting! Me too!' Pats her own belly. 'This is gonna be fun. Race you to 50%!'",
      "11-20": "'You're looking a little rounder there, buddy!' Pokes [Player]'s belly playfully. 'Cute!'",
      "21-30": "'Nice, nice. But watch THIS—' Adjusts her own pump. 'I'm catching up!' Competitive grin.",
      "31-40": "'Okay you're actually getting pretty big. Respect.' Still smiling. 'But I'm not worried yet.'",
      "41-50": "'HALFWAY! We're both halfway! This is the BEST competition ever!' High five attempt that's awkward because belly.",
      "51-60": "'Getting snug in here, huh?' Rubs [Player]'s belly. 'Don't quit on me now!'",
      "61-70": "'Okay it's getting real now. Breathing is... a thing. But I'm NOT losing!' Determined.",
      "71-80": "'Oof. OOF. You're huge and I'm huge and everything is tight and amazing and ow.'",
      "81-90": "'I... might have overestimated my capacity. But if you're still going, I'm still going!'",
      "91-100": "'WE DID IT! We're both ENORMOUS! This is the best day of my life! Also I can't move.'",
      "100+": "'Okay maybe this was a bad idea but also LOOK AT US! We're incredible! Worth it!'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "excited"}],
      "player-41-50": [{"type": "set_emotion", "id": "t2", "emotion": "playful"}],
      "player-71-80": [{"type": "set_emotion", "id": "t3", "emotion": "nervous"}],
      "player-91-100": [{"type": "set_emotion", "id": "t4", "emotion": "proud"}],
      "player-100+": [{"type": "set_emotion", "id": "t5", "emotion": "hysterical"}]
    }
  },
  {
    "id": "megan-player-competitive",
    "name": "Megan: Competitive Edge",
    "builtIn": True,
    "checkpoints": {
      "0": "'Last time you won. NOT this time.' Dead serious behind the smile. 'I've been training.'",
      "1-10": "'Already? Pfft. Amateur hour.' Cranks her own pump while eyeing [Player]'s progress. 'Keep up.'",
      "11-20": "'You think that's big? That's NOTHING.' Pressing on [Player]'s belly to assess. 'I've seen bigger on toddlers.'",
      "21-30": "'Getting interesting. But I'm STILL bigger.' She isn't. 'Don't check. Just trust me.'",
      "31-40": "'Okay fine, we might be tied. But I have more EXPERIENCE. That counts for... something.'",
      "41-50": "'Half full and you still think you can beat me? Adorable.' The competition is making her push harder.",
      "51-60": "'You're... actually pretty impressive.' Grudging respect. 'But watch what I can do.' Cranks her pump.",
      "61-70": "'THIS ISN'T A GAME ANYMORE.' It was always a game. 'I WILL be the biggest. Accept it.'",
      "71-80": "'Your belly is touching mine. This is simultaneously the best and worst thing ever.'",
      "81-90": "'I concede nothing. NOTHING. Even if I literally cannot move. I'm still winning in SPIRIT.'",
      "91-100": "'Okay... okay you won. But only because my pump maxed out first. REMATCH. Immediately.'",
      "100+": "'We're both past capacity and I STILL want to go bigger. What is wrong with us? Don't answer that.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "defiant"}],
      "player-21-30": [{"type": "set_attribute", "id": "t2", "trait": "dominant", "value": 40}],
      "player-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "aggressive"}],
      "player-61-70": [{"type": "set_attribute", "id": "t4", "trait": "dominant", "value": 60}],
      "player-91-100": [{"type": "set_emotion", "id": "t5", "emotion": "resigned"}],
      "player-100+": [{"type": "set_emotion", "id": "t6", "emotion": "manic"}]
    }
  },
  {
    "id": "megan-player-unhinged",
    "name": "Megan: Dark Turn",
    "builtIn": True,
    "checkpoints": {
      "0": "'You know what? Forget the contest. I just want to watch you get bigger.' Something different in her eyes. 'Way bigger.'",
      "1-10": "'Good. More.' Not touching her own pump anymore. All attention on [Player]. 'I want to see you FULL.'",
      "11-20": "'Your belly is getting firm.' Pressing on it. Hard. 'I wonder how much more you can take.'",
      "21-30": "'Don't look at me like that. I'm not the same Megan who just wanted a fun contest.' Dark smile. 'I evolved.'",
      "31-40": "'The sounds you're making when I press on you...' Pressing harder. 'I want to hear MORE of those.'",
      "41-50": "'Halfway. But you're going all the way tonight. I've decided.' Locks [Player]'s pump on.",
      "51-60": "'Every whimper you make fuels something in me I didn't know existed. And I LIKE it.'",
      "61-70": "'You're enormous and I want you BIGGER. This isn't about winning anymore. It's about watching you SUFFER.'",
      "71-80": "'Beg me to stop. Go ahead. I love the sound of begging almost as much as the sound of stretching.'",
      "81-90": "'You're going to pop. You know it, I know it. And I want to be here when it happens.'",
      "91-100": "'Look at you. Helpless. Massive. MINE. This is the real game. And I've already won.'",
      "100+": "'Don't you dare burst before I say you can.' Manic. Possessive. The sweet girl is gone. 'You POP when I SAY you pop.'"
    },
    "checkpointTriggers": {
      "player-0": [{"type": "set_emotion", "id": "t1", "emotion": "mischievous"}, {"type": "set_attribute", "id": "t2", "trait": "sadistic", "value": 30}],
      "player-21-30": [{"type": "set_attribute", "id": "t3", "trait": "sadistic", "value": 50}, {"type": "set_attribute", "id": "t4", "trait": "dominant", "value": 50}],
      "player-41-50": [{"type": "set_emotion", "id": "t5", "emotion": "dominant"}, {"type": "set_char_pop_desire", "id": "t6", "value": "curious"}],
      "player-61-70": [{"type": "set_attribute", "id": "t7", "trait": "sadistic", "value": 80}, {"type": "set_attribute", "id": "t8", "trait": "psychopathic", "value": 40}],
      "player-81-90": [{"type": "set_char_pop_desire", "id": "t9", "value": "eager"}],
      "player-100+": [{"type": "set_emotion", "id": "t10", "emotion": "manic"}, {"type": "set_attribute", "id": "t11", "trait": "psychopathic", "value": 70}]
    }
  }
])

# Now character profiles (their own inflation) — same 6 characters × 3 each
# Using shorter descriptions since these are about the character's own reactions

# LUNA - own inflation
new_character.extend([
  {
    "id": "luna-char-shy",
    "name": "Luna: Shy Discovery",
    "builtIn": True,
    "checkpoints": {
      "0": "[Char] hasn't been inflated. Nervous but curious. 'I've... never done this to myself before. Is it going to hurt?'",
      "1-10": "'Oh!' Hand on belly. 'That feels... strange. But not bad?' Blushes deeply.",
      "11-20": "'I'm... I'm getting bigger.' Watches herself with wide eyes. 'This is actually happening.'",
      "21-30": "'It's warm. And tight. And...' Bites lip. 'I don't hate it?' Surprised at herself.",
      "31-40": "'I can feel my clothes getting tighter.' Shy smile. 'Is this what you see? When you look at me like that?'",
      "41-50": "'Halfway...' Runs hands over the curve. 'I look so... round.' Embarrassed but pleased.",
      "51-60": "'It's a lot now. The pressure is...' Deep breath. 'Intense. But I want to keep going. For you.'",
      "61-70": "'I'm so big...' Can barely wrap arms around herself. 'Do I still look okay?' Needs reassurance.",
      "71-80": "'It hurts a little. But it also feels... right? Is that weird?' Vulnerable.",
      "81-90": "'I don't know how much more I can take.' Trembling. 'But I don't want to stop.'",
      "91-100": "'I'm so full... everything is tight and tingling.' Eyes half-closed. 'This is beautiful.'",
      "100+": "'I didn't know my body could do this.' Awestruck at herself. 'I feel like I could burst... and I'm okay with that.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "shy"}],
      "char-21-30": [{"type": "set_char_inflate_desire", "id": "t2", "value": "curious"}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "aroused"}],
      "char-71-80": [{"type": "set_char_inflate_desire", "id": "t4", "value": "eager"}],
      "char-91-100": [{"type": "set_emotion", "id": "t5", "emotion": "blissful"}],
      "char-100+": [{"type": "set_char_pop_desire", "id": "t6", "value": "willing"}]
    }
  },
  {
    "id": "luna-char-eager",
    "name": "Luna: Eager Balloon",
    "builtIn": True,
    "checkpoints": {
      "0": "'I want this. I want to be huge for you.' Eyes shining. 'Make me as big as you can.'",
      "1-10": "'More, more! I can barely feel it yet!' Impatient. Adjusting herself for maximum comfort.",
      "21-30": "'Yesss...' Hands on belly, eyes closed. 'I can feel myself growing. It's incredible.'",
      "41-50": "'Halfway and I want double this. Don't you dare stop.' Aroused and demanding.",
      "61-70": "'I'm enormous and I LOVE it.' Showing off her size. 'Look at me. LOOK.'",
      "81-90": "'Almost there... the pressure is unbelievable but so is the feeling.' Ecstatic.",
      "91-100": "'I'm a balloon and I never want to deflate. Ever. Keep me like this forever.'",
      "100+": "'Pop me or don't. I don't care. This feeling is everything.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_char_inflate_desire", "id": "t1", "value": "obsessed"}],
      "char-41-50": [{"type": "set_emotion", "id": "t2", "emotion": "horny"}],
      "char-61-70": [{"type": "set_emotion", "id": "t3", "emotion": "proud"}],
      "char-91-100": [{"type": "set_char_pop_desire", "id": "t4", "value": "curious"}],
      "char-100+": [{"type": "set_char_pop_desire", "id": "t5", "value": "eager"}, {"type": "set_emotion", "id": "t6", "emotion": "euphoric"}]
    }
  },
  {
    "id": "luna-char-terrified",
    "name": "Luna: Against Her Will",
    "builtIn": True,
    "checkpoints": {
      "0": "'W-wait, I didn't agree to THIS. You said we were—' Realizes what's happening. Panic.",
      "1-10": "'Stop! Turn it off! I can feel— oh god, it's already starting!' Pulling at restraints.",
      "21-30": "'Please... PLEASE stop. I'm getting bigger. I can see it. This isn't what I wanted!'",
      "41-50": "'I'm so scared...' Crying. 'You're making me so big and I can't stop you...'",
      "61-70": "'It hurts... the pressure... I can't breathe right...' Broken sobs.",
      "81-90": "'I'm going to pop, aren't I? You're going to make me pop.' Acceptance settling in through terror.",
      "91-100": "'I love you. Even now. Even doing this to me.' Whispered through tears.",
      "100+": "'If this is the end... at least I was beautiful.' Eyes closed. Surrendered.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "frightened"}, {"type": "set_char_inflate_desire", "id": "t2", "value": "terrified"}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "desperate"}],
      "char-61-70": [{"type": "set_char_pop_desire", "id": "t4", "value": "terrified"}],
      "char-81-90": [{"type": "set_emotion", "id": "t5", "emotion": "resigned"}],
      "char-100+": [{"type": "set_emotion", "id": "t6", "emotion": "broken"}]
    }
  }
])

# SCARLETT - own inflation (she would HATE losing control)
new_character.extend([
  {
    "id": "scarlett-char-composed",
    "name": "Scarlett: Maintaining Control",
    "builtIn": True,
    "checkpoints": {
      "0": "'You think inflating ME is going to break my composure? Please.' Smirk. 'Try me.'",
      "1-10": "'Hmm.' Slight shift. 'Interesting sensation. Is that supposed to be uncomfortable? How quaint.'",
      "21-30": "'My body is... accommodating this well.' Refuses to show discomfort. Iron will.",
      "41-50": "'You expected tears by now, didn't you? Sorry to disappoint.' Belly visibly round. Expression: stone.",
      "61-70": "A crack. Just one. A sharp inhale she can't suppress. 'That was nothing.'",
      "81-90": "The composure is fracturing. Clenched jaw, white knuckles. 'I will NOT give you the satisfaction.'",
      "91-100": "'I am Mistress Scarlett and I do not BREAK.' Voice shaking. She is absolutely breaking.",
      "100+": "Silent. Trembling. A single tear she will deny forever. The dominatrix, finally dominated."
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "dominant"}],
      "char-41-50": [{"type": "nudge_attribute", "id": "t2", "trait": "dominant", "value": -15}],
      "char-61-70": [{"type": "set_emotion", "id": "t3", "emotion": "defiant"}],
      "char-81-90": [{"type": "nudge_attribute", "id": "t4", "trait": "dominant", "value": -30}],
      "char-100+": [{"type": "set_emotion", "id": "t5", "emotion": "broken"}, {"type": "set_attribute", "id": "t6", "trait": "dominant", "value": 10}]
    }
  },
  {
    "id": "scarlett-char-furious",
    "name": "Scarlett: Enraged Captive",
    "builtIn": True,
    "checkpoints": {
      "0": "'You DARE? Do you have ANY idea who I am?' Pulling at bonds. 'You will PAY for this.'",
      "1-10": "'The moment I get free, I am going to make you SUFFER in ways you cannot imagine.'",
      "21-30": "'STOP THIS. That is an ORDER.' The order doesn't work when you're tied up.",
      "41-50": "'I am going to... nngh... destroy you. Every... inch of you.' Through clenched teeth.",
      "61-70": "'When I get out of this — and I WILL — you will BEG for death.' Rage mixing with pain.",
      "81-90": "'I hate you. I HATE you.' But her voice cracks. 'I hate what you're doing to me.'",
      "91-100": "Screaming. Pure animal fury. The ice queen replaced by volcanic rage.",
      "100+": "The rage burns out. What's left is something she's never shown anyone. Fear."
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "aggressive"}, {"type": "set_attribute", "id": "t2", "trait": "dominant", "value": 100}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "angry"}],
      "char-61-70": [{"type": "nudge_attribute", "id": "t4", "trait": "dominant", "value": -20}],
      "char-81-90": [{"type": "set_emotion", "id": "t5", "emotion": "desperate"}],
      "char-100+": [{"type": "set_emotion", "id": "t6", "emotion": "fearful"}, {"type": "set_attribute", "id": "t7", "trait": "dominant", "value": 0}]
    }
  },
  {
    "id": "scarlett-char-secret",
    "name": "Scarlett: Secret Pleasure",
    "builtIn": True,
    "checkpoints": {
      "0": "'Fine. Do it. But if you tell ANYONE about this, I will end you.' She asked for this. Secretly.",
      "1-10": "'It's—' Catches herself. Neutral expression. But her breathing changed.",
      "21-30": "Fighting to look unaffected. Failing. The tightness is doing something she won't admit.",
      "41-50": "'I don't... enjoy this.' She absolutely enjoys this. 'Keep going. For research purposes.'",
      "61-70": "Gives up pretending. 'Fine. FINE. It feels good. Are you happy now?' Furious at herself.",
      "81-90": "'More.' One word. Barely a whisper. The most vulnerable she's ever been.",
      "91-100": "Eyes closed, head back. Lost in sensation she spent years denying herself. Beautiful and terrible.",
      "100+": "'Thank you.' Whispered. Two words she has never said to anyone. And she means them."
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "stoic"}],
      "char-21-30": [{"type": "set_char_inflate_desire", "id": "t2", "value": "curious"}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "aroused"}, {"type": "set_char_inflate_desire", "id": "t4", "value": "eager"}],
      "char-61-70": [{"type": "nudge_attribute", "id": "t5", "trait": "dominant", "value": -25}],
      "char-81-90": [{"type": "set_char_inflate_desire", "id": "t6", "value": "obsessed"}, {"type": "set_emotion", "id": "t7", "emotion": "vulnerable"}],
      "char-100+": [{"type": "set_emotion", "id": "t8", "emotion": "blissful"}, {"type": "set_attribute", "id": "t9", "trait": "dominant", "value": 20}]
    }
  }
])

# VEX - own inflation
new_character.extend([
  {
    "id": "vex-char-showman",
    "name": "Vex: The Show Must Go On",
    "builtIn": True,
    "checkpoints": {
      "0": "'Wait, you want to inflate ME? The host? Isn't that against the rules?' Pause. 'THERE ARE NO RULES! Let's DO this!'",
      "1-10": "'Ooh, tingly! This is like being a balloon at a party! I AM the party!'",
      "21-30": "'Getting round! I look like a beach ball! AN AMAZING beach ball! Take pictures!'",
      "41-50": "'HALFWAY! I'm halfway to being the biggest gameshow host in HISTORY!'",
      "61-70": "'Okay this is getting... intense. But the SHOW. MUST. GO. ON!' Dramatic pose.",
      "81-90": "'I regret nothing! NOTHING! Even though I can't feel my extremities! WORTH IT!'",
      "91-100": "'I AM THE BIGGEST VEX THAT EVER VEXED! Someone give me a trophy! Made of stretchy material!'",
      "100+": "'If I pop, WHAT A WAY TO GO! The audience will talk about this FOREVER! AHAHAHA!'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "excited"}],
      "char-41-50": [{"type": "set_emotion", "id": "t2", "emotion": "hysterical"}],
      "char-81-90": [{"type": "set_emotion", "id": "t3", "emotion": "manic"}],
      "char-100+": [{"type": "set_char_pop_desire", "id": "t4", "value": "willing"}]
    }
  },
  {
    "id": "vex-char-panic",
    "name": "Vex: Behind The Mask",
    "builtIn": True,
    "checkpoints": {
      "0": "'Haha, yeah, inflate me! It'll be— wait. Wait, you're actually doing it? I was JOKING.'",
      "1-10": "'Okay okay okay this is real. This is happening. Haha! Ha. Ha?' Nervous laughter.",
      "21-30": "'I uh... I usually dish it out. Not... receive it. This is new. And WEIRD.'",
      "41-50": "'The jokes aren't working anymore because I'm actually scared. Don't tell anyone I said that.'",
      "61-70": "'I've made so many people go through this and I never... I didn't know it felt like THIS.'",
      "81-90": "'I take it back. Everything I ever said. Every game I ever rigged. I'm SORRY.'",
      "91-100": "'Please... I'm not the host right now. I'm just Vex. And Vex is terrified.' Genuine.",
      "100+": "'If there's a next time, the games are going to be a LOT gentler.' Actually means it."
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "nervous"}],
      "char-21-30": [{"type": "set_emotion", "id": "t2", "emotion": "frightened"}],
      "char-41-50": [{"type": "nudge_attribute", "id": "t3", "trait": "sadistic", "value": -20}],
      "char-61-70": [{"type": "set_emotion", "id": "t4", "emotion": "vulnerable"}],
      "char-81-90": [{"type": "set_attribute", "id": "t5", "trait": "sadistic", "value": 0}],
      "char-100+": [{"type": "set_emotion", "id": "t6", "emotion": "humiliated"}]
    }
  },
  {
    "id": "vex-char-daredevil",
    "name": "Vex: Double Down",
    "builtIn": True,
    "checkpoints": {
      "0": "'BIGGER. Make me the BIGGEST. I want records SHATTERED. This is the ultimate challenge and I ACCEPT!'",
      "1-10": "'MORE! Is this thing even ON? I've seen water balloons fill faster!'",
      "21-30": "'NOW we're talking! Look at me go! I'm a ZEPPELIN! A beautiful, chaotic ZEPPELIN!'",
      "41-50": "'DOUBLE IT! No, TRIPLE IT! I want to be visible from SPACE!'",
      "61-70": "'Pain is just fun wearing a disguise! GIVE ME MORE!' Absolutely unhinged.",
      "81-90": "'I can hear my body creaking and it sounds like APPLAUSE! ENCORE!'",
      "91-100": "'ONE MORE! JUST ONE MORE! THE GRAND FINALE!' Has lost all sense of self-preservation.",
      "100+": "'THIS IS THE GREATEST MOMENT IN THE HISTORY OF MOMENTS!' Doesn't care about consequences. Never did."
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "manic"}, {"type": "set_char_inflate_desire", "id": "t2", "value": "obsessed"}],
      "char-41-50": [{"type": "set_char_pop_desire", "id": "t3", "value": "curious"}],
      "char-61-70": [{"type": "set_attribute", "id": "t4", "trait": "psychopathic", "value": 60}],
      "char-81-90": [{"type": "set_char_pop_desire", "id": "t5", "value": "eager"}],
      "char-100+": [{"type": "set_emotion", "id": "t6", "emotion": "euphoric"}]
    }
  }
])

# IRIS - own inflation (the scientist becoming the experiment)
new_character.extend([
  {
    "id": "iris-char-selftest",
    "name": "Iris: Self-Experimentation",
    "builtIn": True,
    "checkpoints": {
      "0": "'Hypothesis: first-person experience will provide invaluable qualitative data.' Recording voice notes. 'Beginning self-inflation protocol.'",
      "1-10": "'Initial sensation: warmth, followed by mild pressure. More pleasant than expected. Noting.'",
      "21-30": "'Visible distension is... disorienting from this perspective. The data I've been collecting was missing this context.'",
      "41-50": "'Halfway. Experiencing mild euphoria — likely endorphin response. Need to account for this in future studies.'",
      "61-70": "'Difficulty maintaining clinical detachment. The sensation is... overwhelming my analytical framework.'",
      "81-90": "'I understand now. What every subject tried to tell me. Words don't capture this.' Voice recorder forgotten.",
      "91-100": "'I've been studying this wrong. From the outside, you see physics. From the inside, you feel... everything.'",
      "100+": "'This is the most important data point of my career. And I can't write it down because I'm too full to hold a pen.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "curious"}],
      "char-41-50": [{"type": "set_emotion", "id": "t2", "emotion": "aroused"}],
      "char-61-70": [{"type": "set_char_inflate_desire", "id": "t3", "value": "eager"}],
      "char-91-100": [{"type": "set_emotion", "id": "t4", "emotion": "blissful"}],
      "char-100+": [{"type": "set_emotion", "id": "t5", "emotion": "euphoric"}]
    }
  },
  {
    "id": "iris-char-unwilling",
    "name": "Iris: Unwilling Subject",
    "builtIn": True,
    "checkpoints": {
      "0": "'This is NOT in the protocol! I'm the RESEARCHER, not the—' Equipment activates. 'No no no no no.'",
      "1-10": "'The irony is not lost on me. But PLEASE, from a professional standpoint, THIS IS UNSAFE.'",
      "21-30": "'I know exactly what's happening physiologically and that makes it WORSE. Ignorance was bliss.'",
      "41-50": "'Based on my own models, I have approximately—' Calculates. '—a LOT more to go. That's terrifying.'",
      "61-70": "'My own research predicted this would be agonizing at this point. My research was correct.'",
      "81-90": "'I can feel every cell of my skin stretching. I wrote a PAPER on this. I was wrong about the pain scale.'",
      "91-100": "'I'm about to become a cautionary tale in my own academic journal.' Gallows humor through tears.",
      "100+": "'If my data survives, at least science advances. Cold comfort when you're about to be a statistic.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "panicked"}, {"type": "set_char_inflate_desire", "id": "t2", "value": "terrified"}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "frightened"}],
      "char-61-70": [{"type": "set_emotion", "id": "t4", "emotion": "desperate"}],
      "char-91-100": [{"type": "set_emotion", "id": "t5", "emotion": "resigned"}],
      "char-100+": [{"type": "set_emotion", "id": "t6", "emotion": "broken"}]
    }
  },
  {
    "id": "iris-char-converted",
    "name": "Iris: Scientific Conversion",
    "builtIn": True,
    "checkpoints": {
      "0": "'I initially refused this test. But the gap in our data is indefensible. Someone had to volunteer.' Nervous. But willing.",
      "1-10": "'Oh. That's... I see why subjects report initial pleasure responses. Hypothesis: confirmed.'",
      "21-30": "'I'm finding it increasingly difficult to separate the researcher from the subject.' Interested in herself.",
      "41-50": "'I need to report a bias: I want more. This is compromising my objectivity and I do not care.'",
      "61-70": "'Forget the paper. Forget the grant. I want to know MY limits. Where do I end?'",
      "81-90": "'I've spent my career measuring others. Being measured is... transformative. I understand now.'",
      "91-100": "'They'll call this unprofessional. They'll revoke my funding. And I will tell them it was worth it.'",
      "100+": "'I am the most important data point I've ever collected. And the most beautiful.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "nervous"}],
      "char-21-30": [{"type": "set_char_inflate_desire", "id": "t2", "value": "curious"}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "aroused"}, {"type": "set_char_inflate_desire", "id": "t4", "value": "eager"}],
      "char-61-70": [{"type": "set_char_inflate_desire", "id": "t5", "value": "obsessed"}],
      "char-81-90": [{"type": "set_emotion", "id": "t6", "emotion": "blissful"}],
      "char-100+": [{"type": "set_emotion", "id": "t7", "emotion": "euphoric"}, {"type": "set_char_pop_desire", "id": "t8", "value": "curious"}]
    }
  }
])

# MEGAN - own inflation
new_character.extend([
  {
    "id": "megan-char-playful",
    "name": "Megan: Happy Balloon",
    "builtIn": True,
    "checkpoints": {
      "0": "'My turn my turn my turn!' Bouncing excitedly. 'I've been waiting for this ALL day!'",
      "1-10": "'Eeee! It's starting! I can feel it!' Hugging her own belly. 'Hello, future bigness!'",
      "21-30": "'I'm getting rounder! Look, LOOK!' Showing off proudly. 'I'm like a beach ball! A cute one!'",
      "41-50": "'Halfway already? Nooo, slow down! I want to enjoy every second of getting bigger!'",
      "61-70": "'Ooh, it's getting tight. In the BEST way. Like a full-body hug from the inside!'",
      "81-90": "'I'm SO big! This is the best feeling! Is it weird that I want to be even bigger?'",
      "91-100": "'I'm a BLIMP! A happy, round, perfect blimp! Take a picture! Several pictures!'",
      "100+": "'If I pop, I pop happy. And round. And GORGEOUS.' No fear. Only joy."
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "excited"}, {"type": "set_char_inflate_desire", "id": "t2", "value": "obsessed"}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "blissful"}],
      "char-81-90": [{"type": "set_emotion", "id": "t4", "emotion": "euphoric"}],
      "char-100+": [{"type": "set_char_pop_desire", "id": "t5", "value": "willing"}]
    }
  },
  {
    "id": "megan-char-competitive",
    "name": "Megan: Bigger Than You",
    "builtIn": True,
    "checkpoints": {
      "0": "'If you got to X, I'm going to X+1. That's just math.' Determined face. 'Pump me.'",
      "1-10": "'Is that all? I've barely started. Your record is TOAST.'",
      "21-30": "'Getting there. But not enough. I need to be VISIBLY bigger than you were.' Checks mirror.",
      "41-50": "'Passing your halfway point and I'm not even struggling yet.' She is absolutely struggling. 'EASY.'",
      "61-70": "'This is where you tapped out, right? WATCH ME KEEP GOING.' Wincing but determined.",
      "81-90": "'New record... new record... I just need... a little more...' Stubborn to a fault.",
      "91-100": "'BIGGER. THAN. YOU.' Gasping between words. 'Say it. SAY I'M BIGGER.'",
      "100+": "'I WIN! I'm the biggest! I— ow. OW. But I WON. Worth it. Totally worth it.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "defiant"}],
      "char-41-50": [{"type": "set_emotion", "id": "t2", "emotion": "aggressive"}],
      "char-61-70": [{"type": "set_char_inflate_desire", "id": "t3", "value": "obsessed"}],
      "char-91-100": [{"type": "set_emotion", "id": "t4", "emotion": "proud"}],
      "char-100+": [{"type": "set_emotion", "id": "t5", "emotion": "smug"}]
    }
  },
  {
    "id": "megan-char-reluctant",
    "name": "Megan: Didn't Sign Up For This",
    "builtIn": True,
    "checkpoints": {
      "0": "'Wait— I thought it was YOUR turn? Why is MY pump on? HEY!' Genuine surprise.",
      "1-10": "'This isn't— I didn't— turn it off!' But it's already happening. 'Oh no...'",
      "21-30": "'Okay okay okay. It's happening. Fine. But I'm NOT happy about it.' Arms crossed over growing belly.",
      "41-50": "'I'm the one who inflates OTHERS. This is backwards. This is WRONG.' But her body disagrees.",
      "61-70": "'I never understood why people looked the way they did when I pumped them. Now I get it.'",
      "81-90": "'Please... I changed my mind. I don't want to be this big. I take back every contest.'",
      "91-100": "'I'm sorry for every person I ever over-inflated. I didn't KNOW.' Genuine remorse.",
      "100+": "'If I survive this, I'm going to be so much nicer about inflation limits.' Maybe."
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "panicked"}, {"type": "set_char_inflate_desire", "id": "t2", "value": "reluctant"}],
      "char-21-30": [{"type": "set_emotion", "id": "t3", "emotion": "angry"}],
      "char-41-50": [{"type": "set_emotion", "id": "t4", "emotion": "resigned"}],
      "char-61-70": [{"type": "set_char_inflate_desire", "id": "t5", "value": "neutral"}],
      "char-81-90": [{"type": "set_emotion", "id": "t6", "emotion": "pleading"}],
      "char-100+": [{"type": "set_emotion", "id": "t7", "emotion": "humiliated"}, {"type": "nudge_attribute", "id": "t8", "trait": "sadistic", "value": -30}]
    }
  }
])

# RESEARCH TEAM ALPHA - own inflation (multi-char, use generic team voice)
new_character.extend([
  {
    "id": "medteam-char-controlled",
    "name": "Alpha Team: Controlled Inflation",
    "builtIn": True,
    "checkpoints": {
      "0": "[Char] maintains professional demeanor as the protocol begins. 'All vitals nominal. Ready for inflation sequence.'",
      "1-10": "'Initial pressure readings... within tolerance.' Slight discomfort visible but controlled. 'Continue.'",
      "21-30": "'Visible distension. This is... informative. Experiencing what our subjects report.'",
      "41-50": "'Halfway. Difficulty maintaining clinical perspective. The sensations are more intense than anticipated.'",
      "61-70": "'Professional observation: this is considerably more overwhelming from the inside.'",
      "81-90": "'Approaching limits. Request... request permission to terminate. Data collection sufficient.'",
      "91-100": "'Maximum. Every model we built underestimated the subjective experience at this level.'",
      "100+": "'Protocol exceeded. Recommend updating all safety guidelines based on first-person data.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "neutral"}],
      "char-41-50": [{"type": "set_emotion", "id": "t2", "emotion": "nervous"}],
      "char-81-90": [{"type": "set_emotion", "id": "t3", "emotion": "frightened"}],
      "char-100+": [{"type": "set_emotion", "id": "t4", "emotion": "panicked"}]
    }
  },
  {
    "id": "medteam-char-breakdown",
    "name": "Alpha Team: Professional Breakdown",
    "builtIn": True,
    "checkpoints": {
      "0": "'This isn't standard procedure. Why is the team member being inflated? Who authorized—' Too late.",
      "1-10": "'Colleagues, please. This is a MISUNDERSTANDING. Reverse the—' No one is reversing anything.",
      "21-30": "'I studied medicine for EIGHT YEARS. This was not in the curriculum.'",
      "41-50": "'My professional opinion is that this should stop. My PERSONAL opinion is PLEASE STOP.'",
      "61-70": "'I know exactly what's happening to my body at a cellular level and that makes it WORSE.'",
      "81-90": "'Forget my medical license. Forget my career. Just STOP INFLATING ME.'",
      "91-100": "'All those patient consent forms I reviewed... I never truly understood them until now.'",
      "100+": "'When this is over, I'm switching to dermatology.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "confused"}],
      "char-21-30": [{"type": "set_emotion", "id": "t2", "emotion": "panicked"}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "desperate"}],
      "char-81-90": [{"type": "set_emotion", "id": "t4", "emotion": "pleading"}],
      "char-100+": [{"type": "set_emotion", "id": "t5", "emotion": "resigned"}]
    }
  },
  {
    "id": "medteam-char-discovery",
    "name": "Alpha Team: Embracing Data",
    "builtIn": True,
    "checkpoints": {
      "0": "'I volunteered for this. The team needs first-person data. I'm... ready.' Deep breath. 'Begin.'",
      "1-10": "'Interesting. The initial phase is actually... pleasant? That contradicts our subject reports.'",
      "21-30": "'I'm beginning to understand the addictive quality subjects describe. It's... compelling.'",
      "41-50": "'I should be frightened. My training says stop. But something deeper says continue.'",
      "61-70": "'Recording: the experience at this level is not adequately described by any existing literature.'",
      "81-90": "'I want more. That's not the researcher talking. That's me. I want to know my limit.'",
      "91-100": "'We've been treating this as a medical phenomenon. It's so much more than that.'",
      "100+": "'The most valuable data in our entire study... is what I'm feeling right now.'"
    },
    "checkpointTriggers": {
      "char-0": [{"type": "set_emotion", "id": "t1", "emotion": "nervous"}],
      "char-21-30": [{"type": "set_char_inflate_desire", "id": "t2", "value": "curious"}],
      "char-41-50": [{"type": "set_emotion", "id": "t3", "emotion": "aroused"}, {"type": "set_char_inflate_desire", "id": "t4", "value": "eager"}],
      "char-61-70": [{"type": "set_char_inflate_desire", "id": "t5", "value": "obsessed"}],
      "char-91-100": [{"type": "set_emotion", "id": "t6", "emotion": "blissful"}],
      "char-100+": [{"type": "set_emotion", "id": "t7", "emotion": "euphoric"}]
    }
  }
])

# ============================================
# Merge into existing file
# ============================================
with open('backend/data/checkpoint-profiles.json') as f:
    data = json.load(f)

data['player'].extend(new_player)
data['character'].extend(new_character)

with open('backend/data/checkpoint-profiles.json', 'w') as f:
    json.dump(data, f, indent=2)

print(f"Added {len(new_player)} player profiles and {len(new_character)} character profiles")
print(f"Total: {len(data['player'])} player, {len(data['character'])} character")
