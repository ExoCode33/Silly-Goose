const { Client, GatewayIntentBits, SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

class MessageBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });
        
        this.activeJobs = new Map(); // Track active message jobs
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.once('ready', () => {
            console.log(`✅ Bot logged in as ${this.client.user.tag}`);
            console.log(`🤖 Bot is running on ${this.client.guilds.cache.size} servers`);
            this.registerCommands();
            
            // Set bot status
            this.client.user.setActivity('Sending messages | /write', { type: 'WATCHING' });
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            try {
                if (interaction.commandName === 'write') {
                    await this.handleWriteCommand(interaction);
                } else if (interaction.commandName === 'stop') {
                    await this.handleStopCommand(interaction);
                } else if (interaction.commandName === 'status') {
                    await this.handleStatusCommand(interaction);
                } else if (interaction.commandName === 'check-english') {
                    await this.handleCheckEnglishCommand(interaction);
                }
            } catch (error) {
                console.error('Error handling interaction:', error);
                
                const errorMessage = 'An error occurred while processing your command.';
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            }
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });

        this.client.on('disconnect', () => {
            console.log('Bot disconnected');
        });

        this.client.on('reconnecting', () => {
            console.log('Bot reconnecting...');
        });
    }

    async registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('write')
                .setDescription('Send repeated messages to a channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel to send messages to')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText)
                )
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('The message to send')
                        .setRequired(true)
                        .setMaxLength(2000)
                )
                .addIntegerOption(option =>
                    option.setName('interval')
                        .setDescription('Time between messages in seconds (minimum 5)')
                        .setRequired(true)
                        .setMinValue(5)
                        .setMaxValue(3600)
                )
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Total number of messages to send (default: infinite)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(100)
                )
                .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

            new SlashCommandBuilder()
                .setName('stop')
                .setDescription('Stop all active message jobs in this server')
                .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

            new SlashCommandBuilder()
                .setName('status')
                .setDescription('View active message jobs in this server')
                .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

            new SlashCommandBuilder()
                .setName('check-english')
                .setDescription('Check and correct English mistakes in recent messages')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user whose messages to check (defaults to yourself)')
                        .setRequired(false)
                )
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Number of recent messages to check (default: 10, max: 50)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to check messages from (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText)
                )
                .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
        ];

        try {
            console.log('🔄 Registering slash commands...');
            await this.client.application.commands.set(commands);
            console.log('✅ Slash commands registered successfully');
        } catch (error) {
            console.error('❌ Error registering commands:', error);
        }
    }

    async handleWriteCommand(interaction) {
        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');
        const interval = interaction.options.getInteger('interval');
        const count = interaction.options.getInteger('count') || null;

        // Check bot permissions
        const botMember = interaction.guild.members.cache.get(this.client.user.id);
        if (!channel.permissionsFor(botMember).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel])) {
            return interaction.reply({
                content: `❌ I don't have permission to send messages in ${channel}. Please check my permissions.`,
                ephemeral: true
            });
        }

        // Check user permissions
        if (!channel.permissionsFor(interaction.member).has(PermissionFlagsBits.SendMessages)) {
            return interaction.reply({
                content: `❌ You don't have permission to send messages in ${channel}.`,
                ephemeral: true
            });
        }

        // Create job ID
        const jobId = `${interaction.guild.id}-${channel.id}-${Date.now()}`;
        
        // Stop any existing jobs for this channel
        const stoppedJobs = this.stopJobsForChannel(interaction.guild.id, channel.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Message Job Started')
            .addFields(
                { name: '📝 Message', value: `\`\`\`${message}\`\`\``, inline: false },
                { name: '📍 Channel', value: `${channel}`, inline: true },
                { name: '⏱️ Interval', value: `${interval} seconds`, inline: true },
                { name: '🔢 Count', value: count ? count.toString() : 'Infinite', inline: true },
                { name: '🆔 Job ID', value: `\`${jobId}\``, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Started by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        if (stoppedJobs > 0) {
            embed.addFields({ name: '⚠️ Notice', value: `Stopped ${stoppedJobs} existing job(s) for this channel`, inline: false });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });

        this.startMessageJob(jobId, channel, message, interval, count, interaction.user);
    }

    async handleStopCommand(interaction) {
        const guildId = interaction.guild.id;
        const stoppedJobs = this.stopJobsForGuild(guildId);

        const embed = new EmbedBuilder()
            .setTimestamp()
            .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        if (stoppedJobs > 0) {
            embed
                .setColor(0xff6b6b)
                .setTitle('🛑 Jobs Stopped')
                .setDescription(`Successfully stopped **${stoppedJobs}** active message job(s) in this server.`);
        } else {
            embed
                .setColor(0xffa500)
                .setTitle('ℹ️ No Active Jobs')
                .setDescription('No active message jobs found in this server.');
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleStatusCommand(interaction) {
        const guildId = interaction.guild.id;
        const guildJobs = Array.from(this.activeJobs.values()).filter(job => job.channel.guild.id === guildId);

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('📊 Active Message Jobs')
            .setTimestamp()
            .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        if (guildJobs.length === 0) {
            embed.setDescription('No active message jobs in this server.');
        } else {
            const jobList = guildJobs.map((job, index) => {
                const runtime = Math.floor((Date.now() - job.startTime) / 1000);
                const hours = Math.floor(runtime / 3600);
                const minutes = Math.floor((runtime % 3600) / 60);
                const seconds = runtime % 60;
                const runtimeStr = `${hours}h ${minutes}m ${seconds}s`;
                
                return `**${index + 1}.** ${job.channel}\n` +
                       `└ Messages: ${job.messagesSent}/${job.count || '∞'} | Runtime: ${runtimeStr}\n` +
                       `└ Started by: ${job.user.tag}`;
            }).join('\n\n');

            embed.setDescription(jobList);
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleCheckEnglishCommand(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const limit = interaction.options.getInteger('limit') || 10;
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        // Check bot permissions
        const botMember = interaction.guild.members.cache.get(this.client.user.id);
        if (!targetChannel.permissionsFor(botMember).has([PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ViewChannel])) {
            return interaction.editReply({
                content: `❌ I don't have permission to read message history in ${targetChannel}. Please check my permissions.`
            });
        }

        try {
            // Fetch recent messages from the user
            const messages = await targetChannel.messages.fetch({ limit: 100 });
            const userMessages = messages
                .filter(msg => msg.author.id === targetUser.id && !msg.author.bot && msg.content.trim().length > 0)
                .first(limit);

            if (userMessages.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor(0xffa500)
                    .setTitle('ℹ️ No Messages Found')
                    .setDescription(`No recent messages found from ${targetUser.tag} in ${targetChannel}.`)
                    .setTimestamp()
                    .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

                return interaction.editReply({ embeds: [embed] });
            }

            // Analyze messages for English corrections
            const corrections = [];
            for (const msg of userMessages) {
                const originalText = msg.content;
                const correctedText = this.correctEnglish(originalText);
                
                if (originalText !== correctedText) {
                    corrections.push({
                        original: originalText,
                        corrected: correctedText,
                        timestamp: msg.createdAt,
                        messageId: msg.id
                    });
                }
            }

            const embed = new EmbedBuilder()
                .setColor(corrections.length > 0 ? 0xff9500 : 0x00ff00)
                .setTitle(`📝 English Check Results for ${targetUser.displayName}`)
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

            if (corrections.length === 0) {
                embed
                    .setDescription(`✅ Great job! No English mistakes found in the last ${userMessages.length} messages from ${targetUser.tag}.`)
                    .addFields({
                        name: '📊 Summary',
                        value: `**Messages checked:** ${userMessages.length}\n**Mistakes found:** 0`,
                        inline: false
                    });
            } else {
                embed.setDescription(`Found ${corrections.length} message(s) with potential English improvements:`);
                
                // Add corrections as fields (Discord has a limit of 25 fields)
                const maxFields = Math.min(corrections.length, 10);
                for (let i = 0; i < maxFields; i++) {
                    const correction = corrections[i];
                    const fieldValue = `**Original:** ${correction.original}\n**Suggested:** ${correction.corrected}`;
                    
                    embed.addFields({
                        name: `Message ${i + 1}`,
                        value: fieldValue.length > 1024 ? fieldValue.substring(0, 1021) + '...' : fieldValue,
                        inline: false
                    });
                }

                if (corrections.length > maxFields) {
                    embed.addFields({
                        name: '📋 Note',
                        value: `Showing ${maxFields} out of ${corrections.length} corrections. Use a smaller limit to see fewer results.`,
                        inline: false
                    });
                }

                embed.addFields({
                    name: '📊 Summary',
                    value: `**Messages checked:** ${userMessages.length}\n**Messages with corrections:** ${corrections.length}`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in check-english command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while checking English. Please make sure I have permission to read message history in the specified channel.'
            });
        }
    }

    correctEnglish(text) {
        // Basic English correction rules
        let corrected = text;

        // Common grammar fixes
        const corrections = [
            // Capitalization
            { pattern: /^[a-z]/, replacement: (match) => match.toUpperCase() }, // Start of sentence
            { pattern: /\. [a-z]/g, replacement: (match) => match.toUpperCase() }, // After periods
            { pattern: /\? [a-z]/g, replacement: (match) => match.toUpperCase() }, // After question marks
            { pattern: /! [a-z]/g, replacement: (match) => match.toUpperCase() }, // After exclamation marks
            
            // Common word corrections
            { pattern: /\bi\b/g, replacement: 'I' }, // Lowercase "i" should be "I"
            { pattern: /\bim\b/gi, replacement: "I'm" }, // "im" should be "I'm"
            { pattern: /\bcant\b/gi, replacement: "can't" }, // "cant" should be "can't"
            { pattern: /\bdont\b/gi, replacement: "don't" }, // "dont" should be "don't"
            { pattern: /\bwont\b/gi, replacement: "won't" }, // "wont" should be "won't"
            { pattern: /\bisnt\b/gi, replacement: "isn't" }, // "isnt" should be "isn't"
            { pattern: /\barent\b/gi, replacement: "aren't" }, // "arent" should be "aren't"
            { pattern: /\bwasnt\b/gi, replacement: "wasn't" }, // "wasnt" should be "wasn't"
            { pattern: /\bwerent\b/gi, replacement: "weren't" }, // "werent" should be "weren't"
            { pattern: /\bhavent\b/gi, replacement: "haven't" }, // "havent" should be "haven't"
            { pattern: /\bhasnt\b/gi, replacement: "hasn't" }, // "hasnt" should be "hasn't"
            { pattern: /\bhadnt\b/gi, replacement: "hadn't" }, // "hadnt" should be "hadn't"
            { pattern: /\bwouldnt\b/gi, replacement: "wouldn't" }, // "wouldnt" should be "wouldn't"
            { pattern: /\bcouldnt\b/gi, replacement: "couldn't" }, // "couldnt" should be "couldn't"
            { pattern: /\bshouldnt\b/gi, replacement: "shouldn't" }, // "shouldnt" should be "shouldn't"
            { pattern: /\bmustnt\b/gi, replacement: "mustn't" }, // "mustnt" should be "mustn't"
            { pattern: /\bdidnt\b/gi, replacement: "didn't" }, // "didnt" should be "didn't"
            { pattern: /\bdoesnt\b/gi, replacement: "doesn't" }, // "doesnt" should be "doesn't"
            
            // Common spelling mistakes
            { pattern: /\bteh\b/gi, replacement: 'the' },
            { pattern: /\band\s+and\b/gi, replacement: 'and' }, // Double "and"
            { pattern: /\bthe\s+the\b/gi, replacement: 'the' }, // Double "the"
            { pattern: /\ba\s+a\b/gi, replacement: 'a' }, // Double "a"
            { pattern: /\bto\s+to\b/gi, replacement: 'to' }, // Double "to"
            { pattern: /\bof\s+of\b/gi, replacement: 'of' }, // Double "of"
            { pattern: /\bin\s+in\b/gi, replacement: 'in' }, // Double "in"
            { pattern: /\bfor\s+for\b/gi, replacement: 'for' }, // Double "for"
            { pattern: /\bwith\s+with\b/gi, replacement: 'with' }, // Double "with"
            { pattern: /\bon\s+on\b/gi, replacement: 'on' }, // Double "on"
            { pattern: /\bat\s+at\b/gi, replacement: 'at' }, // Double "at"
            { pattern: /\bby\s+by\b/gi, replacement: 'by' }, // Double "by"
            { pattern: /\bfrom\s+from\b/gi, replacement: 'from' }, // Double "from"
            { pattern: /\bup\s+up\b/gi, replacement: 'up' }, // Double "up"
            { pattern: /\babout\s+about\b/gi, replacement: 'about' }, // Double "about"
            { pattern: /\binto\s+into\b/gi, replacement: 'into' }, // Double "into"
            { pattern: /\bover\s+over\b/gi, replacement: 'over' }, // Double "over"
            { pattern: /\bafter\s+after\b/gi, replacement: 'after' }, // Double "after"
            
            // Extra spaces
            { pattern: /\s+/g, replacement: ' ' }, // Multiple spaces to single space
            { pattern: /\s+([,.!?;:])/g, replacement: '$1' }, // Space before punctuation
            { pattern: /([,.!?;:])\s*([,.!?;:])/g, replacement: '$1 $2' }, // Space after punctuation
        ];

        // Apply corrections
        corrections.forEach(rule => {
            corrected = corrected.replace(rule.pattern, rule.replacement);
        });

        // Clean up extra spaces and trim
        corrected = corrected.replace(/\s+/g, ' ').trim();

        return corrected;
    }

    startMessageJob(jobId, channel, message, interval, count, user) {
        const job = {
            channel,
            message,
            interval,
            count,
            user,
            messagesSent: 0,
            startTime: Date.now()
        };

        // Send first message immediately
        this.sendMessage(channel, message, jobId).then(() => {
            job.messagesSent++;
            console.log(`📤 Sent initial message for job ${jobId} (${job.messagesSent}/${count || '∞'})`);
        }).catch(error => {
            console.error(`❌ Failed to send initial message for job ${jobId}:`, error);
            this.stopJob(jobId);
            return;
        });

        // Set up interval for subsequent messages
        const intervalId = setInterval(async () => {
            try {
                // Check if job should stop
                if (count && job.messagesSent >= count) {
                    console.log(`✅ Job ${jobId} completed (${job.messagesSent}/${count} messages sent)`);
                    this.stopJob(jobId);
                    return;
                }

                await this.sendMessage(channel, message, jobId);
                job.messagesSent++;
                console.log(`📤 Sent message for job ${jobId} (${job.messagesSent}/${count || '∞'})`);

            } catch (error) {
                console.error(`❌ Error in message job ${jobId}:`, error);
                this.stopJob(jobId);
            }
        }, interval * 1000);

        job.intervalId = intervalId;
        this.activeJobs.set(jobId, job);

        console.log(`🚀 Started message job ${jobId} for user ${user.tag} in ${channel.guild.name}#${channel.name}`);
    }

    async sendMessage(channel, message, jobId) {
        try {
            await channel.send(message);
        } catch (error) {
            console.error(`❌ Failed to send message for job ${jobId}:`, error);
            throw error;
        }
    }

    stopJob(jobId) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            clearInterval(job.intervalId);
            this.activeJobs.delete(jobId);
            console.log(`🛑 Stopped message job ${jobId} (sent ${job.messagesSent} messages)`);
            return true;
        }
        return false;
    }

    stopJobsForChannel(guildId, channelId) {
        let stopped = 0;
        for (const [jobId, job] of this.activeJobs) {
            if (job.channel.guild.id === guildId && job.channel.id === channelId) {
                this.stopJob(jobId);
                stopped++;
            }
        }
        return stopped;
    }

    stopJobsForGuild(guildId) {
        let stopped = 0;
        for (const [jobId, job] of this.activeJobs) {
            if (job.channel.guild.id === guildId) {
                this.stopJob(jobId);
                stopped++;
            }
        }
        return stopped;
    }

    async start(token) {
        if (!token) {
            console.error('❌ Bot token is required. Please set the DISCORD_TOKEN environment variable.');
            process.exit(1);
        }

        try {
            console.log('🔄 Starting Discord bot...');
            await this.client.login(token);
        } catch (error) {
            console.error('❌ Failed to start bot:', error);
            process.exit(1);
        }
    }

    async stop() {
        console.log('🛑 Stopping all active jobs...');
        // Stop all active jobs
        for (const jobId of this.activeJobs.keys()) {
            this.stopJob(jobId);
        }
        
        console.log('🔌 Disconnecting from Discord...');
        await this.client.destroy();
        console.log('✅ Bot stopped successfully');
    }
}

// Initialize and start the bot
const bot = new MessageBot();

// Get token from environment variable (Railway will provide this)
const BOT_TOKEN = process.env.DISCORD_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ DISCORD_TOKEN environment variable is not set!');
    console.log('ℹ️  Please set your Discord bot token in Railway environment variables.');
    process.exit(1);
}

// Start the bot
bot.start(BOT_TOKEN);

// Handle graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`\n📡 Received ${signal}, shutting down gracefully...`);
    await bot.stop();
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = MessageBot;
