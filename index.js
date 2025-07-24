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
