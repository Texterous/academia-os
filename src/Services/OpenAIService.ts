// Import the SemanticScholar library
import { message } from "antd"
import { Document } from "langchain/document"
import { CharacterTextSplitter } from "langchain/text_splitter"
import { asyncForEach } from "../Helpers/asyncForEach"
import { MemoryVectorStore } from "langchain/vectorstores/memory"
import { OpenAIEmbeddings } from "langchain/embeddings/openai"
import { uniqBy } from "../Helpers/uniqBy"
import { ChatOpenAI } from "langchain/chat_models/openai"
import { HumanMessage, SystemMessage } from "langchain/schema"
import { OpenAI } from "langchain/llms/openai"
import { AcademicPaper } from "../Types/AcademicPaper"

export class OpenAIService {
  public static getOpenAIKey = () => {
    return localStorage.getItem("openAIKey") || ""
  }
  static async streamCompletion(prompt: string, callback: any) {
    const chat = new ChatOpenAI({
      maxTokens: 800,
      streaming: true,
      openAIApiKey: OpenAIService.getOpenAIKey(),
    })

    await chat.call([new HumanMessage(prompt)], {
      callbacks: [
        {
          handleLLMNewToken(token) {
            callback(token)
          },
        },
      ],
    })
  }

  static async getDetailAboutPaper(paper: AcademicPaper, detail: string) {
    const model = new ChatOpenAI({
      maxTokens: 20,
      openAIApiKey: OpenAIService.getOpenAIKey(),
    })

    let fullText = paper?.fullText

    if ((paper?.fullText?.length || 0) > 5000) {
      const documents = []
      const splitter = new CharacterTextSplitter({
        separator: " ",
        chunkSize: 1000,
        chunkOverlap: 50,
      })
      const output = await splitter.createDocuments(
        [`${paper?.title || ""} ${paper?.fullText || ""}`],
        [{ id: paper?.id || paper?.corpusId }]
      )
      documents.push(...(output || []))

      // Create embeddings
      const embeddings = new OpenAIEmbeddings({
        openAIApiKey: OpenAIService.getOpenAIKey(),
      })
      // Create the Voy store.
      const store = new MemoryVectorStore(embeddings)

      // Add two documents with some metadata.
      await store.addDocuments(documents)

      const query = await embeddings.embedQuery(detail || "")

      // Perform a similarity search.
      const resultsWithScore = await store.similaritySearchVectorWithScore(
        query,
        4
      )

      fullText = resultsWithScore
        .map(([result, score]) => {
          return result.pageContent
        })
        ?.join("\n\n[...]\n\n")
    }

    if ((fullText?.length || 0) > 0) {
      const result = await model.predictMessages([
        new SystemMessage(
          "You extract information from a paper. Answer the question shortly and concisely in only one or few words about the given abstract, no need for full sentences. Only reply with the answer. Does not have to be perfect, but if you don't have a somewhat acceptable answer, reply 'n/a'."
        ),
        new HumanMessage(
          `${paper?.title}\n${fullText}\n\nDescribe the '${detail}' of the given paper.`
        ),
      ])

      return result?.content === detail ? "n/a" : result?.content
    }
    return ""
  }

  static async initialCodingOfPaper(paper: AcademicPaper) {
    const model = new ChatOpenAI({
      maxTokens: 300, // Modify as needed
      openAIApiKey: OpenAIService.getOpenAIKey(),
    })

    let fullText = paper?.fullText
    let chunks = []

    // Splitting the paper into smaller chunks if it's too large
    if ((paper?.fullText?.length || 0) > 5000) {
      const splitter = new CharacterTextSplitter({
        separator: " ",
        chunkSize: 10000,
        chunkOverlap: 50,
      })
      const output = await splitter.createDocuments(
        [`${paper?.title || ""} ${paper?.fullText || ""}`],
        [{ id: paper?.id || paper?.corpusId }]
      )
      chunks.push(...(output || []))
    } else {
      chunks.push({
        id: paper?.id || paper?.corpusId,
        pageContent: fullText,
      })
    }

    // Initialize array to hold codes for each chunk
    let initialCodesArray = [] as string[]

    // Loop through each chunk and apply initial coding
    await asyncForEach(chunks, async (chunk, index) => {
      console.log(`Processing chunk ${index + 1} of ${chunks.length}`)
      const result = await model.predictMessages([
        new SystemMessage(
          'You are tasked with applying the initial coding phase of the Gioia method to the provided academic paper. In this phase, scrutinize the text to identify emergent themes, concepts, or patterns. Your output should be a JSON-formatted array of strings no longer than 7 words, each representing a distinct initial code. For example, your output should look like this: ["Emergent Theme 1", "Notable Concept", "Observed Pattern"]. Ensure to return ONLY a proper JSON array of strings.'
        ),
        new HumanMessage(
          `${paper?.title}\n${chunk.pageContent}\n\nPerform initial coding according to the Gioia method on the given paper, return a JSON array.`
        ),
      ])

      try {
        const codes = result?.content
          ? JSON.parse(result?.content?.replace(/\\n/g, " "))
          : []
        initialCodesArray.push(...codes)
      } catch (error) {
        console.log(error)
      }
    })

    return initialCodesArray
  }

  static async secondOrderCoding(codesArray: string[]) {
    const model = new ChatOpenAI({
      maxTokens: 2000,
      openAIApiKey: OpenAIService.getOpenAIKey(),
    })

    // Convert the array of initial codes into a JSON string
    const jsonString = JSON.stringify(codesArray)

    // Create a message prompt for 2nd order coding
    const result = await model.predictMessages([
      new SystemMessage(
        'You are tasked with applying the 2nd Order Coding phase of the Gioia method. In this phase, identify higher-level themes or categories that aggregate the initial codes. Your output should be a JSON-formatted object mapping each higher-level theme to an array of initial codes that belong to it. For example, your output should look like this: {"Higher-Level Theme 1": ["Emergent Theme 1", "Notable Concept"], "Higher-Level Theme 2": ["Observed Pattern"]}. Ensure to return ONLY a proper JSON object.'
      ),
      new HumanMessage(
        `The initial codes are as follows: ${jsonString}\n\nPerform 2nd Order Coding according to the Gioia method and return a JSON object of 20-30 focus codes.`
      ),
    ])

    // Parse the output and return
    try {
      const secondOrderCodes = result?.content
        ? JSON.parse(result?.content?.replace(/\\n/g, " "))
        : {}
      return secondOrderCodes
    } catch (error) {
      console.log(error)
      return {}
    }
  }

  static async aggregateDimensions(secondOrderCodes: Record<string, string[]>) {
    const model = new ChatOpenAI({
      maxTokens: 2000,
      openAIApiKey: OpenAIService.getOpenAIKey(),
    })

    // Convert the JSON object of 2nd order codes into a JSON string
    const jsonString = JSON.stringify(secondOrderCodes)

    // Create a message prompt for the Aggregate Dimensions phase
    const result = await model.predictMessages([
      new SystemMessage(
        'You are tasked with applying the Aggregate Dimensions phase of the Gioia method. In this phase, identify overarching theoretical dimensions that aggregate the 2nd order codes. Your output should be a JSON-formatted object mapping each aggregate dimension to an array of 2nd order codes that belong to it. For example, your output should look like this: {"some dim": ["theme", "another theme"], "another dim": ["theme123"]}. Ensure to return ONLY a proper JSON object.'
      ),
      new HumanMessage(
        `The 2nd order codes are as follows: ${jsonString}\n\nPerform aggregation into theoretical dimensions according to the Gioia method and return a JSON object.`
      ),
    ])

    // Parse the output and return
    try {
      const aggregateDimensions = result?.content
        ? JSON.parse(result?.content?.replace(/\\n/g, " "))
        : {}
      return aggregateDimensions
    } catch (error) {
      console.log(error)
      return {}
    }
  }
}
