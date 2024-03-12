require("dotenv").config();

let Datastore = require("nedb-promises");

const { WechatyBuilder } = require("wechaty");
let { FileBox } = require("file-box");
let { v1: uuid } = require("uuid");

let _ = require("lodash");

let fastify = require("fastify")({
  logger: true,
});

let UserDB = Datastore.create("./data/users.db");
let RoomDB = Datastore.create("./data/rooms.db");

let { PuppetWechat4u } = require("wechaty-puppet-wechat4u");
const { Contact } = require("wechaty-puppet/types");

// let { EventLogger } = require("wechaty-plugin-contrib");

const puppet = new PuppetWechat4u();

let sleep = function () {
  return new Promise(function (resolve) {
    return setTimeout(resolve, _.random(1.2, 3.2) * 1000);
  });
};

bot = WechatyBuilder.build({
  name: "bot", // generate xxxx.memory-card.json and save login data for the next login
  puppet,
});

// let bot = new PuppetWechat4u();
bot
  .on("scan", function (qrcode) {
    if (qrcode) {
      require("qrcode-terminal").generate(qrcode, {
        small: true,
      });
    }
  })
  .on("friendship", async function (friendship) {
    var contact;
    // 自动通过好友， 并发送拉入群提醒
    await sleep();
    switch (friendship.type()) {
      case bot.Friendship.Type.Receive:
        return await friendship.accept();
      case bot.Friendship.Type.Confirm:
        contact = friendship.contact();
        return await sendWebhook(contact);
    }
  })
  .on("room-join", async function (room, inviteeList, inviter) {
    var i, invitee, len, results;
    results = [];
    for (i = 0, len = inviteeList.length; i < len; i++) {
      invitee = inviteeList[i];
      if (invitee.self()) {
        // unless room.payload.ownerId is inviter.id
        //   return inviter.say "仅限群主邀请才可获得推送地址"
        await room.say(
          "大家好,我是推送精灵, 通过接口可以控制我发送消息到群上."
        );
        results.push(await sendRoomWebHook(inviter, room));
      } else {
        results.push(void 0);
      }
    }
    return results;
  })
  .on("room-invite", async function (roomInvitation) {
    return await roomInvitation.accept();
  })
  .on("message", async function (message) {
    var text;
    text = message.text();
    if (text === "webhook" || text === "推送地址") {
      return await sendWebhook(message.talker());
    }
  })
  .on("error", console.error);

let sendWebhook = async function (contact) {
  var token, name;

  try {
    name = await contact.name();

    token = Buffer.from(name).toString("base64");

    return await contact.say(
      `发送地址: ${process.env.DOMAIN}/send/${token}?msg=xxx`
    );
  } catch (error) {
    console.log(error);
  }
};

let sendRoomWebHook = async function (contact, room) {
  var _send, r, token;
  _send = async function (token) {
    return await room.say(
      `发送地址: ${process.env.DOMAIN}/room/${token}?msg=xxx`
    );
  };
  r = await RoomDB.findOne({
    contactid: contact.id,
    roomid: room.id,
  });
  if (r) {
    return await _send(r.token);
  }
  token = uuid();
  await RoomDB.insert({
    roomid: room.id,
    token: token,
    contactid: contact.id,
  });
  return await _send(token);
};

fastify.register(require("@fastify/rate-limit"), {
  max: 100,
  global: false,
});

fastify.get(
  "/send/:token",
  {
    config: {
      rateLimit: {
        max: 10,
        keyGenerator: function (req) {
          return req.params.token;
        },
      },
    },
  },
  async function (request, reply) {
    var contact, msg, token, name;
    ({ msg } = request.query);
    ({ token } = request.params);

    name = Buffer.from(token, "base64").toString("utf8");
    contact = await bot.Contact.find({ name: name });

    if (!contact) {
      return {
        status: false,
        msg: "token not exists",
      };
    }
    try {
      await contact.say(msg);
      return {
        status: true,
      };
    } catch (error) {
      return {
        status: false,
        error: error,
      };
    }
  }
);

fastify.get(
  "/room/:token",
  {
    config: {
      rateLimit: {
        max: 10,
        keyGenerator: function (req) {
          return req.params.token;
        },
      },
    },
  },
  async function (request, reply) {
    var msg, room, token;
    ({ msg } = request.query);
    ({ token } = request.params);
    room = await RoomDB.findOne({
      token: token,
    });
    if (!room) {
      return {
        status: false,
        msg: "room token not exists",
      };
    }
    room = bot.Room.load(room.roomid);
    room.say(msg);
    return {
      status: true,
    };
  }
);

fastify.post(
  "/send/:token",
  {
    config: {
      rateLimit: {
        max: 10,
        keyGenerator: function (req) {
          return req.params.token;
        },
      },
    },
  },
  async function (request, reply) {
    var contact, image, msg, token, name;
    ({ token } = request.params);

    if (request.query.msg) {
      msg = request.query.msg;
    } else {
      msg = request.body;
      ({ property = "msg" } = request.query);
      const dynamicProperties = property.split("."); // 动态属性层级，可以根据需要进行调整
      for (const prop of dynamicProperties) {
        if (msg.hasOwnProperty(prop)) {
          msg = msg[prop];
        } else {
          console.log(
            `Dynamic property ${property} is not present in the request body`
          );
          // 如果遇到不存在的属性，可以根据需要进行处理
        }
      }
    }

    name = Buffer.from(token, "base64").toString("utf8");
    contact = await bot.Contact.find({ name: name });

    if (!contact) {
      return {
        status: false,
        msg: "token not exists",
      };
    }

    if (typeof msg === "string") {
      await contact.say(msg);
      return {
        status: true,
      };
    }
    if (msg.type === "image") {
      image = FileBox.fromUrl(msg.url);
      await contact.say(image);
      return {
        status: true,
      };
    }
    return {
      status: false,
      msg: "unsupported msg type",
    };
  }
);

let start = async function () {
  await bot
    .start()
    .then(() => console.log("bot start"))
    .catch(console.error);

  await fastify.listen({ port: process.env.PORT || 3000, host: "0.0.0.0" });
  return console.log("listen " + process.env.PORT || 3000);
};

start();
