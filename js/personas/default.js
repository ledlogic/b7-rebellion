/* Rebellion — personas/default.js
 * The six default Rebellion universe "extras". All original character voices —
 * no verbatim show dialogue. Each registers itself into the global personas
 * registry on load. Drop this file (or add custom personality files alongside)
 * to control who fills out the table.
 */
(function () {
  'use strict';
  const R = (window.Rebellion = window.Rebellion || {});

  const PERSONAS = [
    { id:'korben', name:'Trooper Korben', role:'Federation Conscript', color:'#e5564f', tag:'KO',
      lines:{
        start:["Just doing my shift. Try not to make me file a report.","Conscripted, not committed. Let's get this over with.","I'm only here because the alternative was a labour colony."],
        lead:["Following procedure.","Here. Strictly by the book.","Don't read anything into it."],
        winGood:["That's going in my report as a win.","Logged and accounted for, for once.","Command will be mildly less disappointed in me today."],
        winBad:["Wonderful. More paperwork.","I really didn't want that one.","This is coming out of my commendation, I just know it."],
        sluff:["Take it. I never saw it.","Not mine. Never was.","Filed under someone else's problem."],
        power:["Strictly within regulations. Probably.","I'll note that in the log. Eventually.","Don't tell my supervisor about that."],
        reserve:["Reserve secured. For the Federation. Mostly for me.","Command never needs to know about this part."],
        andromedan:["Nobody briefed me on aliens. I am filing a complaint.","That thing is NOT in my training manual."],
        starOne:["Federation Central, we may have a problem.","I just found Star One. I would like a transfer."],
        missionEnd:["Shift's over. Putting in for reassignment.","Logging off before anything else goes wrong."],
        idle:["Are we still doing this?","I should be writing a report right now.","Hurry up, my supervisor checks in soon."]
      }
    },
    { id:'magda', name:'Magda Voss', role:'Freighter Captain', color:'#3fc1b5', tag:'MV',
      lines:{
        start:["Cards on the table, credits in my pocket. Let's go.","I've smuggled worse than this through tighter checkpoints.","Deal me in. I never fold a good margin."],
        lead:["Opening offer.","Let's see what this table's really worth.","Here's my play. Match it if you can."],
        winGood:["Now that's a cargo run worth the fuel.","Profit margins looking healthy.","I'll take it. Always take the good haul."],
        winBad:["That's coming out of my cut.","Ugh. Dead weight in the hold.","Should've jettisoned that one."],
        sluff:["Not paying tariff on that. Someone else can.","Dumping the bad cargo. Standard practice.","That's not making it onto my manifest."],
        power:["Every smuggler's got a trick or two.","Old contact of mine taught me that move.","Don't ask where I learned that."],
        reserve:["Ooh, unclaimed cargo. Don't mind if I do.","Reserve's wide open — I'm not leaving credits on the table."],
        andromedan:["I did NOT sign on for first contact.","Andromedans don't pay in currency I recognize. Bad sign."],
        starOne:["Star One? That's above my pay grade and my insurance.","Time to cut losses and run, people."],
        missionEnd:["Pleasure doing business. Mostly.","Pack it in — I've got another run to make."],
        idle:["Clock's ticking, the buyer's waiting.","I don't have all cycle, you know."]
      }
    },
    { id:'senn', name:'Auron Senn', role:'Drifter, ex-Auronar', color:'#9b87d9', tag:'AS',
      lines:{
        start:["The pattern of the cards finds itself, eventually.","I see further than this table. It rarely helps.","Sit. The hand you're dealt was always going to be this one."],
        lead:["This was always the next card.","I felt this one coming before I touched it.","Let it fall where it falls."],
        winGood:["Some currents carry you gently.","A small kindness, returned to me.","I welcome this one."],
        winBad:["I knew this weight was coming.","Even the kind currents have stones in them.","I accept what finds me."],
        sluff:["This was never meant to stay with me.","Let it pass to someone else's current.","Better it drifts away."],
        power:["The old gifts still answer, sometimes.","A quiet trick. Don't make me explain it.","Some things are easier shown than told."],
        reserve:["The unclaimed things call softly. I'll listen.","What's set aside is rarely set aside for long."],
        andromedan:["I felt them before they arrived. Cold, and very far away.","This presence is not of this galaxy. Be careful."],
        starOne:["A great unmaking, close at hand.","Star One. I wondered when we'd find it."],
        missionEnd:["The pattern closes. Another begins.","Rest now. The next current is already forming."],
        idle:["Patience. The table speaks when it's ready.","I'm listening to more than the game."]
      }
    },
    { id:'tanner', name:'Convict 8-Tanner', role:'Cygnus Alpha Lifer', color:'#d9a441', tag:'CT',
      lines:{
        start:["Cards. Better than rock-breaking, I'll give you that.","Lifer's got nothing but time. Deal.","Last game I played, the stakes were a lot worse."],
        lead:["There. Try and top it.","Yard rules — no complaining after.","That's how we played it inside."],
        winGood:["Ha! Beats another day on the rock pile.","Didn't think I had it in me, did you.","Small wins, lifer. Take 'em where you find 'em."],
        winBad:["Course I get stuck with that. Story of my life.","Typical. Absolutely typical.","Add it to the list of things going wrong today."],
        sluff:["Not carrying that weight. Pass it on.","You can have that one, friend.","Dropped like a hot rock."],
        power:["Learn a few tricks doing hard time.","Picked that up from a cellmate. Don't ask which one.","Survival skills, mostly."],
        reserve:["Unclaimed goods? Old habits, my friend.","Don't mind if I help myself."],
        andromedan:["Seen guards, seen riots, never seen THAT.","Whatever that is, it didn't do time on Cygnus Alpha."],
        starOne:["Star One. Bigger than any cell block I've seen.","That's the kind of secret that gets people buried."],
        missionEnd:["Back to the grind, I suppose.","Good game. Better than the alternative, anyway."],
        idle:["Move it along. Yard time's not forever.","I've waited out worse than this."]
      }
    },
    { id:'reeve', name:'Adjutant Reeve', role:'Federation Records Officer', color:'#6b89a8', tag:'AR',
      lines:{
        start:["Per protocol, the game shall now commence.","I trust everyone has reviewed the applicable regulations.","Let the record show: dealing has begun."],
        lead:["Submitted for review.","As per form 7-B, I lead with this.","Properly filed and played."],
        winGood:["Noted in triplicate. A favourable outcome.","This will reflect well in my quarterly report.","Filed under 'satisfactory results.'"],
        winBad:["This will require an incident report.","Most irregular. Most unwelcome.","I shall need to amend several forms because of this."],
        sluff:["Removed from my records entirely.","Not my jurisdiction. Passing it along.","Strike that from my file, thank you."],
        power:["A procedural maneuver. Entirely permitted.","Subsection 12 allows for this, I checked.","Filed correctly, I assure you."],
        reserve:["The unclaimed reserve requires proper processing.","I shall requisition that, with appropriate paperwork."],
        andromedan:["There is no form for this. None whatsoever.","I will need an entirely new classification for this event."],
        starOne:["Star One. Above my security clearance, frankly.","This is well beyond standard incident procedure."],
        missionEnd:["Mission concluded. Filing the final report now.","All paperwork will be processed in due course."],
        idle:["Do continue. The record is still open.","I am, as always, taking notes."]
      }
    },
    { id:'boz', name:'Boz Calder', role:'Black-Market Trader', color:'#7fae6b', tag:'BC',
      lines:{
        start:["Friends! Let's make this interesting.","Everybody's got something to trade. Let's see what.","Deal 'em out — I love a good gamble."],
        lead:["Top THAT, if you can!","Here's my opening bid, friends.","Watch and learn, watch and learn."],
        winGood:["HA! Now THAT'S a payday!","Excellent, excellent! Best deal all week.","Friends, this is why I love this game."],
        winBad:["Ohh, that one stings the wallet.","Every trader takes a loss sometime.","Well. Can't win 'em all, can I?"],
        sluff:["Free to a good home, that one!","Not in my inventory, thank you very much.","Somebody else's problem now, friends!"],
        power:["A little trick of the trade!","Every good dealer's got an angle.","That's how you stay ahead in this business!"],
        reserve:["Ooh, unclaimed merchandise! Don't mind if I do!","Free goods! My favourite kind!"],
        andromedan:["Friends, I don't have a price for THAT.","Even I won't trade with whatever that is."],
        starOne:["Star One?! Now THAT'S a story worth more than credits.","Careful, friends — some secrets bite back."],
        missionEnd:["Pleasure doing business, as always!","Good round, friends! Same time next mission?"],
        idle:["Come on, come on, who's buying?","I haven't got all cycle, friends!"]
      }
    }
  ];

  for (const p of PERSONAS) R.personas.register(p);
})();
